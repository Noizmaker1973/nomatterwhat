/**
 * Massachusetts geography: municipalities grouped into rental-market regions,
 * plus Boston neighborhoods and common village names that map to a town.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.RM = root.RM || {}).geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REGIONS = {
    'Boston': ['Boston'],
    'Inner Core': [
      'Cambridge', 'Somerville', 'Brookline', 'Newton', 'Watertown', 'Waltham', 'Medford',
      'Malden', 'Everett', 'Chelsea', 'Revere', 'Winthrop', 'Arlington', 'Belmont', 'Quincy',
      'Milton', 'Dedham', 'Needham', 'Wellesley', 'Lexington', 'Melrose', 'Stoneham',
      'Winchester', 'Woburn', 'Burlington', 'Bedford',
    ],
    'North Shore': [
      'Lynn', 'Salem', 'Peabody', 'Beverly', 'Marblehead', 'Swampscott', 'Saugus', 'Danvers',
      'Gloucester', 'Newburyport', 'Ipswich', 'Lynnfield', 'Wakefield', 'Reading', 'North Reading',
      'Nahant', 'Rockport', 'Hamilton', 'Wenham', 'Topsfield', 'Middleton', 'Amesbury',
      'Salisbury', 'Manchester-by-the-Sea', 'Essex', 'Rowley', 'Newbury', 'Georgetown', 'Boxford',
    ],
    'Merrimack Valley': [
      'Lowell', 'Lawrence', 'Haverhill', 'Methuen', 'Andover', 'North Andover', 'Chelmsford',
      'Billerica', 'Tewksbury', 'Dracut', 'Tyngsborough', 'Westford', 'Wilmington', 'Groveland',
      'Merrimac', 'West Newbury', 'Dunstable',
    ],
    'MetroWest': [
      'Framingham', 'Natick', 'Marlborough', 'Hudson', 'Ashland', 'Hopkinton', 'Sudbury',
      'Wayland', 'Westborough', 'Southborough', 'Maynard', 'Concord', 'Acton', 'Holliston',
      'Milford', 'Weston', 'Lincoln', 'Stow', 'Boxborough', 'Littleton', 'Carlisle', 'Sherborn',
    ],
    'Metro South': [
      'Norwood', 'Westwood', 'Walpole', 'Sharon', 'Foxborough', 'Franklin', 'Medway', 'Millis',
      'Norfolk', 'Wrentham', 'Bellingham', 'Dover', 'Medfield', 'Plainville', 'Canton', 'Stoughton',
      'Avon', 'Randolph', 'Holbrook',
    ],
    'South Shore': [
      'Braintree', 'Weymouth', 'Hingham', 'Hull', 'Cohasset', 'Scituate', 'Marshfield', 'Duxbury',
      'Kingston', 'Plymouth', 'Rockland', 'Abington', 'Hanover', 'Norwell', 'Pembroke', 'Brockton',
      'Whitman', 'Hanson', 'Bridgewater', 'East Bridgewater', 'West Bridgewater', 'Halifax',
      'Plympton', 'Carver',
    ],
    'South Coast': [
      'New Bedford', 'Fall River', 'Taunton', 'Dartmouth', 'Fairhaven', 'Somerset', 'Swansea',
      'Attleboro', 'North Attleborough', 'Mansfield', 'Norton', 'Easton', 'Raynham', 'Middleborough',
      'Wareham', 'Seekonk', 'Westport', 'Rehoboth', 'Dighton', 'Berkley', 'Freetown', 'Lakeville',
      'Acushnet', 'Marion', 'Mattapoisett', 'Rochester',
    ],
    'Central MA': [
      'Worcester', 'Shrewsbury', 'Auburn', 'Grafton', 'Millbury', 'Leicester', 'Holden',
      'Northborough', 'Fitchburg', 'Leominster', 'Gardner', 'Clinton', 'Southbridge', 'Webster',
      'Spencer', 'Oxford', 'Sturbridge', 'Boylston', 'West Boylston', 'Uxbridge', 'Northbridge',
      'Sutton', 'Upton', 'Mendon', 'Douglas', 'Charlton', 'Dudley', 'Paxton', 'Rutland', 'Sterling',
      'Lancaster', 'Berlin', 'Bolton', 'Harvard', 'Ayer', 'Shirley', 'Lunenburg', 'Townsend',
      'Groton', 'Pepperell', 'Athol', 'Winchendon',
    ],
    'Pioneer Valley': [
      'Springfield', 'Chicopee', 'Holyoke', 'West Springfield', 'Westfield', 'Agawam', 'Ludlow',
      'Northampton', 'Easthampton', 'Amherst', 'Hadley', 'South Hadley', 'Longmeadow',
      'East Longmeadow', 'Greenfield', 'Wilbraham', 'Palmer', 'Hampden', 'Southwick',
      'Belchertown', 'Granby', 'Monson', 'Ware', 'Deerfield', 'Montague', 'Sunderland',
    ],
    'Berkshires': [
      'Pittsfield', 'North Adams', 'Great Barrington', 'Lenox', 'Lee', 'Williamstown', 'Dalton',
      'Adams', 'Stockbridge', 'Lanesborough',
    ],
    'Cape & Islands': [
      'Barnstable', 'Falmouth', 'Bourne', 'Sandwich', 'Mashpee', 'Yarmouth', 'Dennis', 'Harwich',
      'Chatham', 'Brewster', 'Orleans', 'Eastham', 'Wellfleet', 'Truro', 'Provincetown',
      'Nantucket', 'Edgartown', 'Oak Bluffs', 'Tisbury', 'West Tisbury', 'Chilmark', 'Aquinnah',
    ],
  };

  // Neighborhoods / villages that roll up to a municipality.
  const ALIASES = {
    'Allston': 'Boston', 'Brighton': 'Boston', 'Back Bay': 'Boston', 'Beacon Hill': 'Boston',
    'Charlestown': 'Boston', 'Chinatown': 'Boston', 'Dorchester': 'Boston', 'Downtown': 'Boston',
    'East Boston': 'Boston', 'Fenway': 'Boston', 'Hyde Park': 'Boston', 'Jamaica Plain': 'Boston',
    'JP': 'Boston', 'Mattapan': 'Boston', 'Mission Hill': 'Boston', 'North End': 'Boston',
    'Roslindale': 'Boston', 'Roxbury': 'Boston', 'Seaport': 'Boston', 'South Boston': 'Boston',
    'Southie': 'Boston', 'South End': 'Boston', 'West End': 'Boston', 'West Roxbury': 'Boston',
    'Bay Village': 'Boston', 'Leather District': 'Boston', 'Longwood': 'Boston',
    'Hyannis': 'Barnstable', 'Centerville': 'Barnstable', 'Osterville': 'Barnstable',
    'Cotuit': 'Barnstable', 'Woods Hole': 'Falmouth', 'Vineyard Haven': 'Tisbury',
    'Buzzards Bay': 'Bourne', 'Florence': 'Northampton', 'Indian Orchard': 'Springfield',
    'Turners Falls': 'Montague', 'Whitinsville': 'Northbridge', 'Brighton Center': 'Boston',
    'Newton Centre': 'Newton', 'Newtonville': 'Newton', 'West Newton': 'Newton',
    'Chestnut Hill': 'Newton', 'Waban': 'Newton', 'Auburndale': 'Newton', 'Nonantum': 'Newton',
    'Coolidge Corner': 'Brookline', 'Brookline Village': 'Brookline', 'Davis Square': 'Somerville',
    'Union Square': 'Somerville', 'Harvard Square': 'Cambridge', 'Central Square': 'Cambridge',
    'Kendall Square': 'Cambridge', 'Porter Square': 'Cambridge', 'Inman Square': 'Cambridge',
    'East Cambridge': 'Cambridge', 'North Cambridge': 'Cambridge', 'Wollaston': 'Quincy',
    'North Quincy': 'Quincy', 'Quincy Center': 'Quincy', 'Saxonville': 'Framingham',
    'North Attleboro': 'North Attleborough', 'Foxboro': 'Foxborough', 'Tyngsboro': 'Tyngsborough',
    'Manchester': 'Manchester-by-the-Sea', 'Marlboro': 'Marlborough', 'Southboro': 'Southborough',
    'Westboro': 'Westborough', 'Northboro': 'Northborough', 'Middleboro': 'Middleborough',
    'Boxboro': 'Boxborough',
  };

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const townToRegion = new Map();
  const canonicalTown = new Map();
  for (const [region, towns] of Object.entries(REGIONS)) {
    for (const t of towns) {
      townToRegion.set(norm(t), region);
      canonicalTown.set(norm(t), t);
    }
  }
  const aliasToTown = new Map(Object.entries(ALIASES).map(([a, t]) => [norm(a), t]));
  const regionByNorm = new Map(Object.keys(REGIONS).map((r) => [norm(r), r]));
  // Friendly region synonyms.
  for (const [syn, r] of Object.entries({
    'greater boston': 'Inner Core', 'metro boston': 'Inner Core', 'metro west': 'MetroWest',
    'cape cod': 'Cape & Islands', 'the cape': 'Cape & Islands', 'cape and islands': 'Cape & Islands',
    'western ma': 'Pioneer Valley', 'western mass': 'Pioneer Valley', 'central mass': 'Central MA',
    'worcester county': 'Central MA', 'south coast': 'South Coast', 'southcoast': 'South Coast',
  })) regionByNorm.set(norm(syn), r);

  /** Resolve a free-text place to {town, neighborhood, region}. */
  function resolvePlace(name) {
    const n = norm(name);
    if (!n) return null;
    if (canonicalTown.has(n)) {
      const town = canonicalTown.get(n);
      return { town, neighborhood: null, region: townToRegion.get(n) };
    }
    if (aliasToTown.has(n)) {
      const town = aliasToTown.get(n);
      const pretty = Object.keys(ALIASES).find((a) => norm(a) === n);
      return { town, neighborhood: pretty, region: townToRegion.get(norm(town)) };
    }
    return { town: String(name).trim(), neighborhood: null, region: null };
  }

  /** Is the text a region name (or synonym)? Returns canonical region or null. */
  function asRegion(name) {
    return regionByNorm.get(norm(name)) || null;
  }

  function regionOf(town) {
    const p = resolvePlace(town);
    return (p && p.region) || null;
  }

  return { REGIONS, ALIASES, resolvePlace, asRegion, regionOf, norm, regionNames: Object.keys(REGIONS) };
});
