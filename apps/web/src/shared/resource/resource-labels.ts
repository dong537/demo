interface ResourceLike {
  id?: string | null;
  code?: string | null;
  countryCode?: string | null;
  name?: string | null;
  displayName?: string | null;
  upstreamResourceId?: string | null;
  providerCode?: string | null;
}

export interface ResourceLocationLabel {
  country: string;
  city: string | null;
  line: string | null;
  detail: string | null;
  title: string;
}

export interface ResourceLocationStackLabel {
  country: string;
  detail: string | null;
}

const REGION_NAME_ZH: Record<string, string> = {
  AE: '阿联酋',
  AT: '奥地利',
  AU: '澳大利亚',
  BR: '巴西',
  CA: '加拿大',
  DE: '德国',
  ES: '西班牙',
  FR: '法国',
  GB: '英国',
  HK: '中国香港',
  ID: '印度尼西亚',
  IL: '以色列',
  IN: '印度',
  IT: '意大利',
  JP: '日本',
  KR: '韩国',
  LV: '拉脱维亚',
  MX: '墨西哥',
  MY: '马来西亚',
  NL: '荷兰',
  PH: '菲律宾',
  PL: '波兰',
  RO: '罗马尼亚',
  SA: '沙特阿拉伯',
  SG: '新加坡',
  TH: '泰国',
  TR: '土耳其',
  TW: '中国台湾',
  UA: '乌克兰',
  US: '美国',
  VN: '越南',
  ZA: '南非',
};

const US_STATE_NAME_ZH: Record<string, string> = {
  AL: '阿拉巴马',
  AK: '阿拉斯加',
  AZ: '亚利桑那',
  ARI: '亚利桑那',
  AR: '阿肯色',
  CA: '加利福尼亚',
  CAL: '加利福尼亚',
  CO: '科罗拉多',
  CT: '康涅狄格',
  DE: '特拉华',
  FL: '佛罗里达',
  FLA: '佛罗里达',
  GA: '佐治亚',
  GEO: '佐治亚',
  HI: '夏威夷',
  HAW: '夏威夷',
  ID: '爱达荷',
  IL: '伊利诺伊',
  IN: '印第安纳',
  IA: '爱荷华',
  KS: '堪萨斯',
  KY: '肯塔基',
  LA: '路易斯安那',
  ME: '缅因',
  MD: '马里兰',
  MA: '马萨诸塞',
  MAS: '马萨诸塞',
  MI: '密歇根',
  MN: '明尼苏达',
  MS: '密西西比',
  MO: '密苏里',
  MT: '蒙大拿',
  NE: '内布拉斯加',
  NV: '内华达',
  NEV: '内华达',
  NH: '新罕布什尔',
  NJ: '新泽西',
  NM: '新墨西哥',
  NY: '纽约',
  NYS: '纽约',
  NC: '北卡罗来纳',
  ND: '北达科他',
  OH: '俄亥俄',
  OK: '俄克拉荷马',
  OR: '俄勒冈',
  PA: '宾夕法尼亚',
  PEN: '宾夕法尼亚',
  RI: '罗德岛',
  SC: '南卡罗来纳',
  SD: '南达科他',
  TN: '田纳西',
  TX: '得克萨斯',
  TEX: '得克萨斯',
  UT: '犹他',
  VT: '佛蒙特',
  VA: '弗吉尼亚',
  VIR: '弗吉尼亚',
  WA: '华盛顿',
  WAS: '华盛顿',
  WV: '西弗吉尼亚',
  WI: '威斯康星',
  WY: '怀俄明',
};

const CITY_NAME_ZH: Record<string, string> = {
  ASH: '阿什本',
  AUS: '奥斯汀',
  BOS: '波士顿',
  CAL: '卡拉马祖',
  CHA: '夏洛特',
  CHI: '芝加哥',
  DAL: '达拉斯',
  HNL: '檀香山',
  ILL: '芝加哥',
  IND: '印第安纳波利斯',
  LAS: '拉斯维加斯',
  LAX: '洛杉矶',
  MIA: '迈阿密',
  MSP: '明尼阿波利斯',
  NYC: '纽约',
  PHL: '费城',
  PHX: '凤凰城',
  SAC: '萨克拉门托',
  SAN: '圣安东尼奥',
  SDG: '圣地亚哥',
  SEA: '西雅图',
  SFO: '旧金山',
  SINGAPORE: '新加坡',
  SJC: '圣何塞',
  SLC: '盐湖城',
  TAM: '坦帕',
  WAS: '华盛顿',
};

const CITY_PHRASE_ZH: Record<string, string> = {
  AMSTERDAM: '阿姆斯特丹',
  ASHBURN: '阿什本',
  ATLANTA: '亚特兰大',
  AUSTIN: '奥斯汀',
  BANGKOK: '曼谷',
  BARCELONA: '巴塞罗那',
  BERLIN: '柏林',
  BOSTON: '波士顿',
  BUCHAREST: '布加勒斯特',
  'CAPE TOWN': '开普敦',
  CHARLOTTE: '夏洛特',
  CHICAGO: '芝加哥',
  DALLAS: '达拉斯',
  DELHI: '德里',
  DUBAI: '迪拜',
  FRANKFURT: '法兰克福',
  HANOI: '河内',
  AIRTEL: 'Airtel 线路',
  'BHARTI AIRTEL': 'Bharti Airtel 线路',
  'HO CHI MINH': '胡志明市',
  'HONG KONG': '香港',
  HONOLULU: '檀香山',
  ISTANBUL: '伊斯坦布尔',
  JAKARTA: '雅加达',
  'JERSEY CITY': '泽西城',
  JOHANNESBURG: '约翰内斯堡',
  KALAMAZOO: '卡拉马祖',
  KYIV: '基辅',
  'KUALA LUMPUR': '吉隆坡',
  'LAS VEGAS': '拉斯维加斯',
  LONDON: '伦敦',
  'LOS ANGELES': '洛杉矶',
  MADRID: '马德里',
  MANILA: '马尼拉',
  MELBOURNE: '墨尔本',
  MIAMI: '迈阿密',
  MILAN: '米兰',
  MINNEAPOLIS: '明尼阿波利斯',
  MUMBAI: '孟买',
  'NEW YORK': '纽约',
  'NORTH HOLLAND': '北荷兰',
  'ODIDO NETHERLANDS': '奥迪多荷兰',
  OSAKA: '大阪',
  PARIS: '巴黎',
  PHILADELPHIA: '费城',
  PHOENIX: '凤凰城',
  PISCATAWAY: '皮斯卡塔韦',
  PORTLAND: '波特兰',
  RIGA: '里加',
  ROME: '罗马',
  SACRAMENTO: '萨克拉门托',
  'SAINT LOUIS': '圣路易斯',
  'SALT LAKE CITY': '盐湖城',
  'SAN ANTONIO': '圣安东尼奥',
  'SAN DIEGO': '圣地亚哥',
  'SAN FRANCISCO': '旧金山',
  'SAN JOSE': '圣何塞',
  'SAO PAULO': '圣保罗',
  SEATTLE: '西雅图',
  SEOUL: '首尔',
  SINGAPORE: '新加坡',
  'SIOUX FALLS': '苏福尔斯',
  STLOUIS: '圣路易斯',
  'ST LOUIS': '圣路易斯',
  SYDNEY: '悉尼',
  TAIPEI: '台北',
  TAMPA: '坦帕',
  'TEL AVIV': '特拉维夫',
  TOKYO: '东京',
  TORONTO: '多伦多',
  TYROL: '蒂罗尔',
  'LOWER AUSTRIA': '下奥地利',
  'UPPER AUSTRIA': '上奥地利',
  'ALTIMA TELECOM': '阿尔蒂玛电信',
  'A1 TELEKOM AUSTRIA': 'A1 奥地利电信',
  'A1 TELEKOM AUSTRIA AG': 'A1 奥地利电信',
  MANITOBA: '曼尼托巴',
  'LAC DU BONNET': '拉克迪博内',
  'COMMSTREAM COMMUNICATIONS': '康姆斯特里姆通信',
  BOISSEVAIN: '博伊斯韦恩',
  'WESTMAN COMMUNICATIONS GROUP': '韦斯特曼通信集团',
  'NEW BOTHWELL': '新博斯韦尔',
  STEINBACH: '施泰因巴赫',
  'VALLEY FIBER': '谷地光纤',
  'COMWAVE TELECOM': '科姆韦夫电信',
  GLOUCESTER: '格洛斯特',
  ONTARIO: '安大略',
  'NIAGARA ON THE LAKE': '尼亚加拉湖畔',
  'NOVA SCOTIA': '新斯科舍',
  'VIDEOTRON LTEE': '维迪奥特隆有限公司',
  WOODSTOCK: '伍德斯托克',
  HALIFAX: '哈利法克斯',
  'BELL CANADA BUSINESS': '贝尔加拿大商务',
  INNSBRUCK: '因斯布鲁克',
  'MAGENTA TELEKOM': '麦琴塔电信',
  'MAGENTA TELEKOM INFRASTRUCTURE': '麦琴塔电信基础设施',
  'TELEKOM AUSTRIA': '奥地利电信',
  'TELEKOM AUSTRIA AG': '奥地利电信',
  'BERESTIANE': '贝雷斯佳内',
  'CHERKASY OBLAST': '切尔卡瑟州',
  'CHERNIHIV OBLAST': '切尔尼戈夫州',
  'CHERNIHIV': '切尔尼戈夫',
  'CHERNIVTSI': '切尔诺夫策',
  'DATAGROUP': '数据集团',
  'PRIVATE JOINT STOCK COMPANY DATAGROUP': '数据集团',
  'DONETSK': '顿涅茨克',
  'DUBNO': '杜布诺',
  'EKSINTECH': '埃克辛泰克',
  'JSC UKRTELECOM': '乌克兰电信',
  'KHMELNYTSKYI OBLAST': '赫梅利尼茨基州',
  'KHMELNYTSKYI': '赫梅利尼茨基',
  'KOMPAETELECOM': '孔帕电信',
  'MARIUPOL': '马里乌波尔',
  'RIVNE OBLAST': '罗夫诺州',
  'RIVNE': '罗夫诺',
  'SATANIV': '萨塔尼夫',
  'SHOSTKA': '绍斯特卡',
  'SMILA': '斯米拉',
  'SUMY ONLINE': '苏梅在线',
  'SUMY': '苏梅',
  'UKRTELECOM': '乌克兰电信',
  'VECHIR TELECOM': '韦奇尔电信',
  'VEGA TELECOM': '维加电信',
  'VINNYTSIA': '文尼察',
  'VOLOCHYSK': '沃洛奇斯克',
  'VOLYN': '沃伦',
  VIENNA: '维也纳',
  WARSAW: '华沙',
  WASHINGTON: '华盛顿',
  WIERINGERWERF: '维灵厄韦夫',
};

const COMPACT_US_LINE_ZH: Record<string, string> = {
  USAHAWAII: '夏威夷',
  USAGEORGI: '佐治亚',
};

const LINE_QUALIFIER_ZH: Record<string, string> = {
  REC: '推荐',
  RECOMMENDED: '推荐',
  NORMAL: '普通',
};

const LINE_QUALIFIER_VALUES = new Set(Object.values(LINE_QUALIFIER_ZH));

const US_STATE_NAME_EN: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  ARI: 'Arizona',
  CA: 'California',
  CAL: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  FLA: 'Florida',
  GA: 'Georgia',
  GEO: 'Georgia',
  HI: 'Hawaii',
  HAW: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MAS: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NEV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NYS: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  PEN: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  TEX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  VIR: 'Virginia',
  WA: 'Washington',
  WAS: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

const CITY_NAME_EN: Record<string, string> = {
  ASH: 'Ashburn',
  AUS: 'Austin',
  BOS: 'Boston',
  CAL: 'Kalamazoo',
  CHA: 'Charlotte',
  CHI: 'Chicago',
  DAL: 'Dallas',
  HNL: 'Honolulu',
  ILL: 'Chicago',
  IND: 'Indianapolis',
  LAS: 'Las Vegas',
  LAX: 'Los Angeles',
  MIA: 'Miami',
  MSP: 'Minneapolis',
  NYC: 'New York',
  PHL: 'Philadelphia',
  PHX: 'Phoenix',
  SAC: 'Sacramento',
  SAN: 'San Antonio',
  SDG: 'San Diego',
  SEA: 'Seattle',
  SFO: 'San Francisco',
  SINGAPORE: 'Singapore',
  SJC: 'San Jose',
  SLC: 'Salt Lake City',
  TAM: 'Tampa',
  WAS: 'Washington',
};

const CITY_PHRASE_EN: Record<string, string> = {
  AMSTERDAM: 'Amsterdam',
  ASHBURN: 'Ashburn',
  ATLANTA: 'Atlanta',
  AUSTIN: 'Austin',
  BANGKOK: 'Bangkok',
  BARCELONA: 'Barcelona',
  BERLIN: 'Berlin',
  BOSTON: 'Boston',
  BUCHAREST: 'Bucharest',
  'CAPE TOWN': 'Cape Town',
  CHARLOTTE: 'Charlotte',
  CHICAGO: 'Chicago',
  DALLAS: 'Dallas',
  DELHI: 'Delhi',
  DUBAI: 'Dubai',
  FRANKFURT: 'Frankfurt',
  HANOI: 'Hanoi',
  'HO CHI MINH': 'Ho Chi Minh City',
  'HONG KONG': 'Hong Kong',
  HONOLULU: 'Honolulu',
  ISTANBUL: 'Istanbul',
  JAKARTA: 'Jakarta',
  'JERSEY CITY': 'Jersey City',
  JOHANNESBURG: 'Johannesburg',
  KALAMAZOO: 'Kalamazoo',
  KYIV: 'Kyiv',
  'KUALA LUMPUR': 'Kuala Lumpur',
  'LAS VEGAS': 'Las Vegas',
  LONDON: 'London',
  'NOVA SCOTIA': 'Nova Scotia',
  HALIFAX: 'Halifax',
  'BELL CANADA BUSINESS': 'Bell Canada Business',
  'LOS ANGELES': 'Los Angeles',
  MADRID: 'Madrid',
  MANILA: 'Manila',
  MELBOURNE: 'Melbourne',
  MIAMI: 'Miami',
  MILAN: 'Milan',
  MINNEAPOLIS: 'Minneapolis',
  MUMBAI: 'Mumbai',
  'NEW YORK': 'New York',
  'NORTH HOLLAND': 'North Holland',
  'ODIDO NETHERLANDS': 'Odido Netherlands',
  OSAKA: 'Osaka',
  PARIS: 'Paris',
  PHILADELPHIA: 'Philadelphia',
  PHOENIX: 'Phoenix',
  PISCATAWAY: 'Piscataway',
  PORTLAND: 'Portland',
  RIGA: 'Riga',
  ROME: 'Rome',
  SACRAMENTO: 'Sacramento',
  'SAINT LOUIS': 'Saint Louis',
  'SALT LAKE CITY': 'Salt Lake City',
  'SAN ANTONIO': 'San Antonio',
  'SAN DIEGO': 'San Diego',
  'SAN FRANCISCO': 'San Francisco',
  'SAN JOSE': 'San Jose',
  'SAO PAULO': 'Sao Paulo',
  SEATTLE: 'Seattle',
  SEOUL: 'Seoul',
  SINGAPORE: 'Singapore',
  'SIOUX FALLS': 'Sioux Falls',
  STLOUIS: 'Saint Louis',
  'ST LOUIS': 'Saint Louis',
  SYDNEY: 'Sydney',
  TAIPEI: 'Taipei',
  TAMPA: 'Tampa',
  'TEL AVIV': 'Tel Aviv',
  TOKYO: 'Tokyo',
  TORONTO: 'Toronto',
  'LOWER AUSTRIA': 'Lower Austria',
  'UPPER AUSTRIA': 'Upper Austria',
  VIENNA: 'Vienna',
  WARSAW: 'Warsaw',
  WASHINGTON: 'Washington',
  WIERINGERWERF: 'Wieringerwerf',
};

const COMPACT_US_LINE_EN: Record<string, string> = {
  USAHAWAII: 'Hawaii',
  USAGEORGI: 'Georgia',
};

const LINE_QUALIFIER_EN: Record<string, string> = {
  REC: 'Recommended',
  RECOMMENDED: 'Recommended',
  NORMAL: 'Normal',
};

const LINE_QUALIFIER_VALUES_EN = new Set(Object.values(LINE_QUALIFIER_EN));

const IGNORED_DETAIL_TOKENS = new Set([
  'ADVANCED',
  'BASIC',
  'BOTH',
  'BROADCAST',
  'DEFAULT',
  'HTTP',
  'HTTPS',
  'IP',
  'LINE',
  'NATIVE',
  'PREMIUM',
  'PROXY',
  'RESIDENTIAL',
  'SHARED',
  'SOCKS5',
  'STANDARD',
  'STATIC',
]);

let displayNames: Intl.DisplayNames | null = null;
let displayNamesEn: Intl.DisplayNames | null = null;

export function formatRegionNameZh(resource: ResourceLike): string {
  const code = normalizeRegionCode(resource.countryCode || resource.code);
  const displayName = code ? displayRegionName(code) : null;
  const mapped = code ? REGION_NAME_ZH[code] ?? (displayName && displayName !== code ? displayName : null) : null;
  if (mapped) return mapped;
  return code ? '未知地区' : '-';
}

export function formatRegionNameEn(resource: ResourceLike): string {
  const code = normalizeRegionCode(resource.countryCode || resource.code);
  const mapped = code ? displayRegionNameEn(code) : null;
  if (mapped) return mapped;
  return code || '-';
}

export function formatResourceLocationZh(resource: ResourceLike): ResourceLocationLabel {
  const country = formatRegionNameZh({
    code: normalizeRegionCode(resource.countryCode || resource.code),
    countryCode: normalizeRegionCode(resource.countryCode || resource.code),
    name: null,
    displayName: null,
  });
  const rawDetail = extractResourceDetail(resource, country);
  const detail = rawDetail && rawDetail !== country ? rawDetail : null;
  const { city, line } = splitDetail(detail);
  const proxySellerDetail = splitProxySellerDetail(detail, city, line);
  return {
    country,
    city: proxySellerDetail?.city ?? city,
    line: proxySellerDetail?.line ?? line,
    detail,
    title: detail ? `${country}-${detail}` : country,
  };
}

export function formatResourceLocationEn(resource: ResourceLike): ResourceLocationLabel {
  const country = formatRegionNameEn({
    code: normalizeRegionCode(resource.countryCode || resource.code),
    countryCode: normalizeRegionCode(resource.countryCode || resource.code),
    name: null,
    displayName: null,
  });
  const rawDetail = extractResourceDetailEn(resource, country);
  const detail = rawDetail && rawDetail !== country ? rawDetail : null;
  const { city, line } = splitDetailEn(detail);
  const proxySellerDetail = splitProxySellerDetailEn(detail, city, line);
  return {
    country,
    city: proxySellerDetail?.city ?? city,
    line: proxySellerDetail?.line ?? line,
    detail,
    title: detail ? `${country}-${detail}` : country,
  };
}

export function formatResourceLocationStackZh(resource: ResourceLike): ResourceLocationStackLabel {
  const location = formatResourceLocationZh(resource);
  return {
    country: location.country,
    detail: location.detail ?? ([location.city, location.line].filter(Boolean).join('-') || null),
  };
}

export function formatResourceTypeZh(value?: string | null): string {
  if (value === 'COUNTRY') return '国家/地区';
  if (value === 'REGION') return '地区';
  if (value === 'ZONE') return '可用区';
  return '未知类型';
}

export function formatIpTypeZh(value?: string | null): string {
  if (value === 'NATIVE') return '原生 IP';
  if (value === 'BROADCAST') return '广播 IP';
  if (value === 'BOTH') return '原生/广播';
  return '未知 IP 类型';
}

export function formatProtocolZh(value?: string | null): string {
  if (value === 'HTTP') return 'HTTP/HTTPS';
  if (value === 'SOCKS5') return 'SOCKS5';
  if (value === 'BOTH') return 'SOCKS5 / HTTP';
  return '未知协议';
}

export function formatResourceStatusZh(value?: string | null): string {
  if (value === 'ACTIVE') return '正常';
  if (value === 'HIDDEN') return '隐藏';
  if (value === 'DISABLED') return '停用';
  return '未知状态';
}

export function resourceStatusOptionsZh() {
  return [
    { value: 'ACTIVE', label: formatResourceStatusZh('ACTIVE') },
    { value: 'HIDDEN', label: formatResourceStatusZh('HIDDEN') },
    { value: 'DISABLED', label: formatResourceStatusZh('DISABLED') },
  ];
}

function normalizeRegionCode(value?: string | null): string | null {
  const raw = value?.trim().toUpperCase();
  if (!raw) return null;
  const code = raw.length > 2 ? raw.split(/[:\-_]/)[0].slice(0, 2) : raw;
  if (!code || !/^[A-Z]{2}$/.test(code)) return null;
  return code;
}

function extractResourceDetail(resource: ResourceLike, countryLabel: string): string | null {
  const countryCode = normalizeRegionCode(resource.countryCode || resource.code);
  if (resource.providerCode === 'PR') {
    const proxySellerDetail =
      parseProxySellerPathDetail(resource.code, countryCode)
      ?? parseProxySellerPathDetail(resource.upstreamResourceId, countryCode)
      ?? parseProxySellerPathDetail(resource.displayName, countryCode)
      ?? parseProxySellerPathDetail(resource.name, countryCode);
    if (proxySellerDetail) return translateDetailTokens(proxySellerDetail) || null;
  }
  const parsed = parseProviderLineCode(resource.code, countryCode, { includeNumericTail: false })
    ?? parseProviderLineCode(resource.upstreamResourceId, countryCode, { includeNumericTail: false });
  if (parsed) return parsed;

  const candidates = [resource.displayName, resource.name, resource.code]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const parsedCandidate = parseProviderLineCode(candidate, countryCode, { includeNumericTail: false });
    if (parsedCandidate) return parsedCandidate;

    const detail = stripCountryPrefix(candidate, countryLabel, countryCode);
    if (detail) return translateDetailTokens(detail);
  }
  return parseProviderLineCode(resource.code, countryCode, { includeNumericTail: true })
    ?? parseProviderLineCode(resource.upstreamResourceId, countryCode, { includeNumericTail: true });
}

function extractResourceDetailEn(resource: ResourceLike, countryLabel: string): string | null {
  const countryCode = normalizeRegionCode(resource.countryCode || resource.code);
  if (resource.providerCode === 'PR') {
    const proxySellerDetail =
      parseProxySellerPathDetail(resource.code, countryCode)
      ?? parseProxySellerPathDetail(resource.upstreamResourceId, countryCode)
      ?? parseProxySellerPathDetail(resource.displayName, countryCode)
      ?? parseProxySellerPathDetail(resource.name, countryCode);
    if (proxySellerDetail) return proxySellerDetail;
  }
  const parsed = parseProviderLineCodeEn(resource.code, countryCode, { includeNumericTail: false })
    ?? parseProviderLineCodeEn(resource.upstreamResourceId, countryCode, { includeNumericTail: false });
  if (parsed) return parsed;

  const candidates = [resource.displayName, resource.name, resource.code]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const parsedCandidate = parseProviderLineCodeEn(candidate, countryCode, { includeNumericTail: false });
    if (parsedCandidate) return parsedCandidate;

    const detail = stripCountryPrefix(candidate, countryLabel, countryCode);
    if (detail) return translateDetailTokensEn(detail);
  }
  return parseProviderLineCodeEn(resource.code, countryCode, { includeNumericTail: true })
    ?? parseProviderLineCodeEn(resource.upstreamResourceId, countryCode, { includeNumericTail: true });
}

function parseProxySellerPathDetail(value?: string | null, countryCode?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return null;

  const country = countryCode ?? normalizeRegionCode(parts[0]);
  if (!country || parts[0]?.trim().toUpperCase() !== country) return null;

  const detailParts = parts.slice(1);
  if (detailParts.length === 1 && /^\d+$/.test(detailParts[0] ?? '')) return null;
  if (detailParts.length > 1 && /^\d+$/.test(detailParts[0] ?? '')) detailParts.shift();

  const detail = detailParts.join('-').trim();
  return detail || null;
}

function parseProviderLineCode(
  value?: string | null,
  countryCode?: string | null,
  options: { includeNumericTail?: boolean } = {},
): string | null {
  const raw = value?.trim().toUpperCase();
  if (!raw) return null;
  const country = countryCode ?? normalizeRegionCode(raw);
  if (!country) return null;

  const separated = raw.split(/[:\-_]/).filter(Boolean);
  const tail = separated.length > 1 ? separated.slice(1).join('-') : null;
  if (tail && !/^\d+$/.test(tail)) {
    const tailParts = tail.split('-').map((part) => part.trim()).filter(Boolean);
    if (tailParts.length > 1 && /^\d+$/.test(tailParts[0] ?? '')) {
      const strippedTail = tailParts.slice(1).join('-').trim();
      return translateDetailTokens(strippedTail) || null;
    }
    const parsedTail = parseCompactProviderLineCode(tail, country);
    if (parsedTail) return parsedTail;
    return translateDetailTokens(tail) || null;
  }
  if (tail && options.includeNumericTail && /^\d+$/.test(tail)) return null;
  if (tail) return null;
  if (/\s/.test(raw)) return null;

  const compact = raw.replace(/[^A-Z0-9]/g, '');
  const compactParsed = parseCompactProviderLineCode(compact, country);
  if (compactParsed) return compactParsed;
  return null;
}

function parseCompactProviderLineCode(compact: string, country: string): string | null {
  if (country === 'US') {
    const direct = COMPACT_US_LINE_ZH[compact];
    if (direct) return direct;

    const usaMatch = compact.match(/^USA([A-Z]{3})([A-Z]{3})([A-Z0-9]*)$/);
    if (usaMatch) {
      const state = US_STATE_NAME_ZH[usaMatch[1]];
      const city = CITY_NAME_ZH[usaMatch[2]];
      const suffix = translateDetailTokens(usaMatch[3] ?? '');
      if (!state && !city && !suffix) return null;
      if (state && !city && !suffix) return state;
      return [state, city, suffix].filter(Boolean).join('-');
    }
    const usaGenericMatch = compact.match(/^USA([A-Z0-9]+)$/);
    if (usaGenericMatch) {
      const translated = translateDetailTokens(usaGenericMatch[1] ?? '');
      return translated === usaGenericMatch[1] ? null : translated;
    }
    const usMatch = compact.match(/^US([A-Z]{2})([A-Z]{3})([A-Z0-9]*)$/);
    if (usMatch) {
      const state = US_STATE_NAME_ZH[usMatch[1]];
      const city = CITY_NAME_ZH[usMatch[2]];
      const suffix = translateDetailTokens(usMatch[3] ?? '');
      if (!state && !city && !suffix) return null;
      if (state && !city && !suffix) return state;
      return [state, city, suffix].filter(Boolean).join('-');
    }
  }
  return null;
}

function parseProviderLineCodeEn(
  value?: string | null,
  countryCode?: string | null,
  options: { includeNumericTail?: boolean } = {},
): string | null {
  const raw = value?.trim().toUpperCase();
  if (!raw) return null;
  const country = countryCode ?? normalizeRegionCode(raw);
  if (!country) return null;

  const separated = raw.split(/[:\-_]/).filter(Boolean);
  const tail = separated.length > 1 ? separated.slice(1).join('-') : null;
  if (tail && !/^\d+$/.test(tail)) {
    const tailParts = tail.split('-').map((part) => part.trim()).filter(Boolean);
    if (tailParts.length > 1 && /^\d+$/.test(tailParts[0] ?? '')) {
      const strippedTail = tailParts.slice(1).join('-').trim();
      return translateDetailTokensEn(strippedTail) || null;
    }
    const parsedTail = parseCompactProviderLineCodeEn(tail, country);
    if (parsedTail) return parsedTail;
    return translateDetailTokensEn(tail) || null;
  }
  if (tail && options.includeNumericTail && /^\d+$/.test(tail)) return null;
  if (tail) return null;
  if (/\s/.test(raw)) return null;

  const compact = raw.replace(/[^A-Z0-9]/g, '');
  const compactParsed = parseCompactProviderLineCodeEn(compact, country);
  if (compactParsed) return compactParsed;
  return null;
}

function parseCompactProviderLineCodeEn(compact: string, country: string): string | null {
  if (country === 'US') {
    const direct = COMPACT_US_LINE_EN[compact];
    if (direct) return direct;

    const usaMatch = compact.match(/^USA([A-Z]{3})([A-Z]{3})([A-Z0-9]*)$/);
    if (usaMatch) {
      const state = US_STATE_NAME_EN[usaMatch[1]];
      const city = CITY_NAME_EN[usaMatch[2]];
      const suffix = translateDetailTokensEn(usaMatch[3] ?? '');
      if (!state && !city && !suffix) return null;
      if (state && !city && !suffix) return state;
      return [state, city, suffix].filter(Boolean).join('-');
    }
    const usaGenericMatch = compact.match(/^USA([A-Z0-9]+)$/);
    if (usaGenericMatch) {
      const translated = translateDetailTokensEn(usaGenericMatch[1] ?? '');
      return translated === usaGenericMatch[1] ? null : translated;
    }
    const usMatch = compact.match(/^US([A-Z]{2})([A-Z]{3})([A-Z0-9]*)$/);
    if (usMatch) {
      const state = US_STATE_NAME_EN[usMatch[1]];
      const city = CITY_NAME_EN[usMatch[2]];
      const suffix = translateDetailTokensEn(usMatch[3] ?? '');
      if (!state && !city && !suffix) return null;
      if (state && !city && !suffix) return state;
      return [state, city, suffix].filter(Boolean).join('-');
    }
  }
  return null;
}

function stripCountryPrefix(value: string, countryLabel: string, countryCode: string | null): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized === countryLabel || normalized === countryCode) return null;

  const prefixes = [
    countryLabel,
    countryCode,
    countryCode ? displayRegionName(countryCode) : null,
    countryCode ? displayRegionNameEn(countryCode) : null,
  ].filter((item): item is string => Boolean(item));

  for (const prefix of prefixes) {
    if (normalized.toLowerCase() === prefix.toLowerCase()) return null;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = normalized.match(new RegExp(`^${escaped}(?:\\s*[-_:|]\\s*|\\s+)(.+)$`, 'i'));
    if (match?.[1]?.trim()) return match[1].trim();
  }

  return normalized;
}

function translateDetailTokens(value: string): string {
  const normalized = stripResourceMetadata(value).trim();
  if (!normalized) return '';
  if (/^\d+$/.test(normalized)) return '';
  return translateDetailParts(normalized)
    .filter(Boolean)
    .join('-');
}

function translateDetailTokensEn(value: string): string {
  const normalized = stripResourceMetadata(value).trim();
  if (!normalized) return '';
  if (/^\d+$/.test(normalized)) return '';
  return translateDetailPartsEn(normalized)
    .filter(Boolean)
    .join('-');
}

function stripResourceMetadata(value: string): string {
  return value.replace(/\|cidr=.*$/i, '').trim();
}

function splitDetail(detail: string | null): { city: string | null; line: string | null } {
  if (!detail) return { city: null, line: null };
  const parts = detail.split('-').map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? null;
  const line = last && (LINE_QUALIFIER_VALUES.has(last) || /^线路\d+$/i.test(last)) ? last : null;
  const cityParts = line ? parts.slice(0, -1) : parts;
  const city = cityParts.length > 0 ? cityParts.join('-') : null;
  return { city, line };
}

function splitDetailEn(detail: string | null): { city: string | null; line: string | null } {
  if (!detail) return { city: null, line: null };
  const parts = detail.split('-').map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? null;
  const line = last && (LINE_QUALIFIER_VALUES_EN.has(last) || /^line\s*\d+$/i.test(last)) ? last : null;
  const cityParts = line ? parts.slice(0, -1) : parts;
  const city = cityParts.length > 0 ? cityParts.join('-') : null;
  return { city, line };
}

function splitProxySellerDetail(
  detail: string | null,
  city: string | null,
  line: string | null,
): { city: string | null; line: string | null } | null {
  if (!detail || line || !detail.includes('-')) return null;
  const parts = detail.split('-').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const nextLine = parts[parts.length - 1] ?? null;
  const nextCity = parts.slice(0, -1).join('-') || null;
  if (!nextLine || !nextCity || nextCity === city) return null;
  return { city: nextCity, line: nextLine };
}

function splitProxySellerDetailEn(
  detail: string | null,
  city: string | null,
  line: string | null,
): { city: string | null; line: string | null } | null {
  if (!detail || line || !detail.includes('-')) return null;
  const parts = detail.split('-').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const nextLine = parts[parts.length - 1] ?? null;
  const nextCity = parts.slice(0, -1).join('-') || null;
  if (!nextLine || !nextCity || nextCity === city) return null;
  return { city: nextCity, line: nextLine };
}

function translateDetailParts(value: string): string[] {
  const tokens = value
    .split(/[\s_\-:]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const parts: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const current = tokens[index]?.toUpperCase();
    const next = tokens[index + 1];
    if (current === 'LINE' && next && /^\d+$/.test(next)) {
      parts.push(`线路${next}`);
      index += 2;
      continue;
    }

    let matched = false;
    for (let size = Math.min(4, tokens.length - index); size >= 1; size -= 1) {
      const phrase = tokens.slice(index, index + size).join(' ').toUpperCase();
      const translated = CITY_PHRASE_ZH[phrase];
      if (translated) {
        parts.push(translated);
        index += size;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const token = tokens[index]!;
    const upper = token.toUpperCase();
    const translated = CITY_NAME_ZH[upper] ?? US_STATE_NAME_ZH[upper] ?? LINE_QUALIFIER_ZH[upper];
    if (translated) parts.push(translated);
    else if (!IGNORED_DETAIL_TOKENS.has(upper)) parts.push(formatUnknownDetailTokenZh(token));
    index += 1;
  }
  return parts;
}

function translateDetailPartsEn(value: string): string[] {
  const tokens = value
    .split(/[\s_\-:]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const parts: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const current = tokens[index]?.toUpperCase();
    const next = tokens[index + 1];
    if (current === 'LINE' && next && /^\d+$/.test(next)) {
      parts.push(`Line ${next}`);
      index += 2;
      continue;
    }

    let matched = false;
    for (let size = Math.min(4, tokens.length - index); size >= 1; size -= 1) {
      const phrase = tokens.slice(index, index + size).join(' ').toUpperCase();
      const translated = CITY_PHRASE_EN[phrase];
      if (translated) {
        parts.push(translated);
        index += size;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const token = tokens[index]!;
    const upper = token.toUpperCase();
    const translated = CITY_NAME_EN[upper] ?? US_STATE_NAME_EN[upper] ?? LINE_QUALIFIER_EN[upper];
    if (translated) parts.push(translated);
    else if (!IGNORED_DETAIL_TOKENS.has(upper)) parts.push(formatUnknownDetailTokenEn(token));
    index += 1;
  }
  return parts;
}

function formatUnknownDetailTokenZh(token: string): string {
  const normalized = token.trim();
  if (!normalized || /^\d+$/.test(normalized)) return '';
  if (/^[A-Z0-9]+$/i.test(normalized)) {
    return '';
  }
  return '';
}

function formatUnknownDetailTokenEn(token: string): string {
  const normalized = token.trim();
  if (!normalized || /^\d+$/.test(normalized)) return '';
  return '';
}

function displayRegionName(code: string): string | null {
  try {
    displayNames ??= new Intl.DisplayNames(['zh-CN'], { type: 'region' });
    return displayNames.of(code) ?? null;
  } catch {
    return null;
  }
}

function displayRegionNameEn(code: string): string | null {
  try {
    displayNamesEn ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return displayNamesEn.of(code) ?? null;
  } catch {
    return null;
  }
}
