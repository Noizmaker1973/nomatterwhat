"""The one place NoteLine talks to the network. Standard library only."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "NoteLine/1.0 (lender research; contact via repo owner)"


class FetchError(RuntimeError):
    def __init__(self, url: str, status: int | None, detail: str):
        super().__init__(f"{status or 'network'} fetching {url}: {detail}")
        self.status = status


def get(url: str, params: dict | None = None, headers: dict | None = None,
        tries: int = 3, timeout: int = 60) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    last: FetchError | None = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            body = e.read()[:300].decode("utf-8", "replace")
            last = FetchError(url, e.code, body)
            if e.code < 500 and e.code != 429:
                raise last
        except urllib.error.URLError as e:
            last = FetchError(url, None, str(e.reason))
        time.sleep(2 ** attempt)
    raise last  # type: ignore[misc]


def get_json(url: str, params: dict | None = None, headers: dict | None = None):
    return json.loads(get(url, params, headers))
