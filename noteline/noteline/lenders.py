"""
Who is the lender, really?

Foreclosure plaintiffs and SBA lender names are free text. This module sorts
them into kinds that matter to a note buyer, and matches banks to their FDIC
record so their call report numbers can be attached.

The kinds, in order of how useful they are to someone trying to buy notes:

  portfolio   a bank or credit union foreclosing on a loan it kept on its own
              books. These are the ones that sell notes one at a time or in
              small pools, and they will take a call.
  private     an individual, trust or small LLC — a private or hard-money
              lender. Often the most willing seller of all.
  npl_buyer   a fund or acquisition trust that already bought the note. This
              is the competition; it also shows what is trading.
  servicer    a non-bank servicer (PennyMac, Rocket, NewRez...) or a trustee
              for a securitization. The loan almost always belongs to Fannie,
              Freddie, Ginnie or bondholders; nobody here can sell it to you.
  agency      a housing finance agency or government lender.
"""

from __future__ import annotations

import re

KINDS = ("portfolio", "private", "npl_buyer", "servicer", "agency")

# Trailing clauses that name a predecessor or a capacity, not the lender.
TAIL = re.compile(r"\s*(,\s*)?\b(f/k/a|fka|formerly known as|s/b/m|successor by merger|"
                  r"d/b/a|dba|as successor|as servicer|by and through|its attorney)\b.*$", re.I)

# Funds that buy re-performing and non-performing loans. Named shelves and
# buyers seen in Land Court captions; a plain "Mortgage Loan Trust" is a
# securitization, not a buyer, so it is deliberately not here.
NPL_BUYER = re.compile(
    r"acquisition trust|asset (company|trust|holdings|management)|participation trust|"
    r"loan acquisition|opportunit(y|ies)|\bRPL\d*\b|\bNPL\b|\bfund\b|\bREO\b|"
    r"\bMCLP\b|\bVRMTG\b|\bRCF\b|\bRCAF\b|\bPRPM\b|\bPRET\b|\bLSF\d|\bLSRMF\b|\bARLP\b|"
    r"\bMTGLQ\b|\bPNPMS\b|Ajax|Cascade Funding|Bayview|Stanwich|Dyck-?O.?Neal|"
    r"Legacy Mortgage Asset|Residential Credit|Christiana Trust|"
    r"Wilmington Savings Fund Society", re.I)
# A bank acting as trustee of a mortgage-backed securitization. The loans
# belong to bondholders and are worked out under a pooling agreement.
SECURITIZED = re.compile(r"as (owner )?trustee|trustee for|certificate ?holders|pass[- ]through|"
                         r"asset[- ]backed|mortgage loan trust|\bREMIC\b", re.I)
# Securitization shelves that happen to use buyer-sounding words, and
# pre-2009 vintages, which are legacy deals rather than recent purchases.
SHELF = re.compile(r"securitization trust|structured securities|mortgage[- ]backed securities|"
                   r"\b200[0-8]-", re.I)
AGENCY = re.compile(
    r"Housing Finance Agency|MassHousing|Secretary of (Housing|Veterans)|\bHUD\b|"
    r"Federal National Mortgage|Fannie Mae|Federal Home Loan Mortgage|Freddie Mac|"
    r"Government National|Small Business Administration|Department of|"
    r"Housing Partnership|Housing Authority|\bUSDA\b|Rural Housing", re.I)
DEPOSITORY = re.compile(
    r"\w*bank\b|\bbanc|credit union|\bsavings\b|co-?operative|trust company|\bFSB\b|"
    r"\bN\.?A\.?$|national association|institution for savings|five cents|"
    r"\bfederal credit\b", re.I)
SERVICER = re.compile(
    r"mortgage|servic(ing|er|es)|lending|home loans|loan ?depot|financ(e|ial)|funding|"
    r"PennyMac|Lakeview|NewRez|Shellpoint|Nationstar|Mr\.? Cooper|Onity|PHH|Carrington|"
    r"Selene|Cenlar|Longbridge|Rushmore|Fay Servicing|Specialized Loan|Select Portfolio|"
    r"Planet Home|Servbank|Onslow Bay|Mortgage Assets|Reverse|\bMSR\b|LoanCare|Servis One|"
    r"Guaranteed Rate|Village Capital|Mortgage Acceptance|Celink|Compu-?Link|Click n|"
    # Insurers hold reverse-mortgage and whole-loan books they sell only in bulk.
    r"Insurance Company|Annuity", re.I)

NOISE = re.compile(
    r"\b(the|n\.?a\.?|national association|na|fsb|inc|incorporated|corp|corporation|"
    r"co|company|llc|l\.l\.c|ltd|of massachusetts)\b", re.I)


def clean_name(name: str) -> str:
    """The lender's own name, without predecessor or capacity clauses."""
    name = (name or "").strip()
    name = re.split(r",? not in its individual capacity", name, flags=re.I)[0]
    name = TAIL.sub("", name)
    return re.sub(r",?\s+et al\.?$", "", name, flags=re.I).strip(" ,.")


def buyer_name(name: str) -> str:
    """For a trustee caption, the trust actually holding the note."""
    m = re.search(r"trustee (?:for|of|on behalf of(?: and with respect to)?)\s+(?:the\s+)?(.+)$", name or "", re.I)
    return (m.group(1) if m else clean_name(name)).strip(" ,.")


def norm(name: str) -> str:
    """A matching key: lowercase, no punctuation or corporate suffixes."""
    s = clean_name(name).lower().replace("&", " and ")
    s = NOISE.sub(" ", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def classify(name: str) -> str:
    full = name or ""
    own = clean_name(full)
    if NPL_BUYER.search(full) and not SHELF.search(full):
        return "npl_buyer"
    if SECURITIZED.search(full):
        return "servicer"
    if AGENCY.search(own):
        return "agency"
    if DEPOSITORY.search(own):
        return "portfolio"
    if SERVICER.search(own):
        return "servicer"
    return "private"


class BankIndex:
    """Find an FDIC institution by the name a plaintiff or SBA file uses."""

    def __init__(self, institutions: list[dict]):
        self.by_key: dict[str, list[dict]] = {}
        for inst in institutions:
            self.by_key.setdefault(norm(inst.get("NAME", "")), []).append(inst)

    def match(self, name: str, state: str | None = None) -> dict | None:
        key = norm(name)
        if not key:
            return None
        hits = self.by_key.get(key)
        if not hits:
            # "Citizens Bank" vs FDIC "Citizens Bank, National Association"
            # normalise to the same key; this catches "Rockland Trust" vs
            # "Rockland Trust Company" style drift in either direction.
            hits = [i for k, v in self.by_key.items() for i in v
                    if len(key) >= 8 and (k.startswith(key + " ") or key.startswith(k + " "))]
        if not hits:
            return None
        if state:
            local = [h for h in hits if h.get("STALP") == state]
            if local:
                hits = local
        # Several banks share common names ("First National Bank"). Prefer the
        # biggest; a lender that forecloses in a state is rarely a tiny one far away.
        return max(hits, key=lambda h: float(h.get("ASSET") or 0))
