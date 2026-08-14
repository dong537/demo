import React from 'react';
import './buy.css';
import { buildApiUrl, publicSiteHeaders } from '../../shared/api/client';
import { formatCustomerChannelLabel as formatPublicProviderLabel } from '../../shared/provider/provider-labels';
import { formatResourceLocationZh } from '../../shared/resource/resource-labels';
import { resolveBrandName } from '../../shared/site/brand-display';

interface PublicCountry {
  countryCode?: string;
  countryName?: string;
  availableQuantity?: number;
  resources?: number | PublicSku[];
  cities?: PublicCity[];
  items?: PublicSku[];
  skus?: PublicSku[];
}

interface PublicCity {
  cityCode?: string;
  cityName?: string;
  name?: string;
  availableQuantity?: number;
  resources?: number | PublicSku[];
  items?: PublicSku[];
  skus?: PublicSku[];
}

interface PublicSku {
  id?: string;
  code?: string;
  name?: string;
  displayName?: string;
  lineName?: string;
  providerCode?: string;
  upstreamResourceId?: string;
  isSaleable?: boolean;
  saleable?: boolean;
  status?: string;
  availableQuantity?: number;
  stock?: number | null;
  unitPrice?: string | null;
  priceCurrency?: string | null;
}

interface BrandConfig {
  name?: string;
  siteName?: string;
  logoUrl?: string;
  primaryColor?: string;
  supportEmail?: string;
  footerText?: string;
  publicCountries?: PublicCountry[];
}

interface PublicSite {
  name?: string;
  brandConfig?: BrandConfig | null;
}

interface PublicTenant {
  name?: string;
  brandConfig?: BrandConfig | null;
}

interface CurrentSiteData {
  site?: PublicSite | null;
  tenant?: PublicTenant | null;
}

interface ApiEnvelope<T> {
  code: number | string;
  msg: string;
  data?: T;
}

type SiteLoadState = 'loading' | 'ready' | 'error';

interface PublicCatalogGroup {
  cityCount: number;
  cityRows: PublicCatalogCity[];
  code?: string;
  countLabel: string;
  key: string;
  name: string;
  saleableCount: number;
  skuCount: number | null;
}

interface PublicCatalogCity {
  countLabel: string;
  key: string;
  name: string;
  saleableCount: number;
  skuCount: number | null;
  skus: PublicCatalogSku[];
}

interface PublicCatalogSku {
  key: string;
  label: string;
  priceLabel: string;
  providerLabel: string;
  status: 'saleable' | 'unsaleable' | 'unknown';
  statusLabel: string;
  stockLabel: string;
}

interface CatalogStats {
  cityCount: number;
  countryCount: number;
  saleableCount: number;
  skuCount: number;
}

const loginUrl = '/login';
const registerUrl = '/register';
const customerBuyUrl = '/customer/buy';

const navLinks = [
  ['首页', '/'],
  ['静态住宅', '/pricing'],
  ['动态住宅', '/products/dynamic'],
  ['教程', '/tutorials'],
  ['推广返佣', '/promotion'],
  ['帮助中心', '/faq'],
] as const;

const COUNTRY_NAME_ZH: Record<string, string> = {
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

const COUNTRY_PHRASE_ZH: Record<string, string> = {
  AUSTRALIA: '澳大利亚',
  AUSTRIA: '奥地利',
  BRAZIL: '巴西',
  CANADA: '加拿大',
  CHINA: '中国',
  FRANCE: '法国',
  GERMANY: '德国',
  HONGKONG: '中国香港',
  'HONG KONG': '中国香港',
  INDIA: '印度',
  INDONESIA: '印度尼西亚',
  ISRAEL: '以色列',
  ITALY: '意大利',
  JAPAN: '日本',
  KOREA: '韩国',
  LATVIA: '拉脱维亚',
  MALAYSIA: '马来西亚',
  NETHERLANDS: '荷兰',
  PHILIPPINES: '菲律宾',
  POLAND: '波兰',
  ROMANIA: '罗马尼亚',
  SINGAPORE: '新加坡',
  SPAIN: '西班牙',
  TAIWAN: '中国台湾',
  THAILAND: '泰国',
  TURKEY: '土耳其',
  UK: '英国',
  UKRAINE: '乌克兰',
  'UNITED ARAB EMIRATES': '阿联酋',
  'UNITED KINGDOM': '英国',
  'UNITED STATES': '美国',
  'UNITED STATES OF AMERICA': '美国',
  VIETNAM: '越南',
  'SOUTH AFRICA': '南非',
};

const US_STATE_NAME_ZH: Record<string, string> = {
  ARI: '亚利桑那',
  CA: '加利福尼亚',
  CAL: '加利福尼亚',
  FLA: '佛罗里达',
  FL: '佛罗里达',
  GEO: '佐治亚',
  HAW: '夏威夷',
  IL: '伊利诺伊',
  MA: '马萨诸塞',
  MAS: '马萨诸塞',
  NY: '纽约',
  NYS: '纽约',
  TEX: '得克萨斯',
  TX: '得克萨斯',
  VIR: '弗吉尼亚',
  VA: '弗吉尼亚',
  WAS: '华盛顿',
  WA: '华盛顿',
};

const CITY_CODE_ZH: Record<string, string> = {
  ASH: '阿什本',
  ATL: '亚特兰大',
  AUS: '奥斯汀',
  BOS: '波士顿',
  CHI: '芝加哥',
  DAL: '达拉斯',
  HNL: '檀香山',
  LAX: '洛杉矶',
  MIA: '迈阿密',
  NYC: '纽约',
  PHL: '费城',
  PHX: '凤凰城',
  SEA: '西雅图',
  SFO: '旧金山',
  SJC: '圣何塞',
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
  CHICAGO: '芝加哥',
  DALLAS: '达拉斯',
  DELHI: '德里',
  DUBAI: '迪拜',
  FRANKFURT: '法兰克福',
  HANOI: '河内',
  'HO CHI MINH': '胡志明市',
  HONOLULU: '檀香山',
  ISTANBUL: '伊斯坦布尔',
  JAKARTA: '雅加达',
  'JERSEY CITY': '泽西城',
  JOHANNESBURG: '约翰内斯堡',
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
  OSAKA: '大阪',
  PARIS: '巴黎',
  PHILADELPHIA: '费城',
  PHOENIX: '凤凰城',
  PORTLAND: '波特兰',
  RIGA: '里加',
  ROME: '罗马',
  'SAINT LOUIS': '圣路易斯',
  'SAN FRANCISCO': '旧金山',
  'SAN JOSE': '圣何塞',
  'SAO PAULO': '圣保罗',
  SEATTLE: '西雅图',
  SEOUL: '首尔',
  SINGAPORE: '新加坡',
  SYDNEY: '悉尼',
  TAIPEI: '台北',
  'TEL AVIV': '特拉维夫',
  TOKYO: '东京',
  TORONTO: '多伦多',
  VIENNA: '维也纳',
  WARSAW: '华沙',
  WASHINGTON: '华盛顿',
};

const LINE_QUALIFIER_ZH: Record<string, string> = {
  NORMAL: '普通商品',
  REC: '推荐商品',
  RECOMMENDED: '推荐商品',
};

const IGNORED_LINE_TOKENS = new Set([
  'ADVANCED',
  'BASIC',
  'BROADCAST',
  'DEFAULT',
  'HTTP',
  'HTTPS',
  'IP',
  'NATIVE',
  'PREMIUM',
  'PROXY',
  'RESIDENTIAL',
  'SHARED',
  'SOCKS5',
  'STANDARD',
  'STATIC',
]);

let zhRegionNames: Intl.DisplayNames | null = null;

export function PublicBuyPage() {
  const [site, setSite] = React.useState<PublicSite | null>(null);
  const [tenant, setTenant] = React.useState<PublicTenant | null>(null);
  const [loadState, setLoadState] = React.useState<SiteLoadState>('loading');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [selectedCountryKey, setSelectedCountryKey] = React.useState<string | null>(null);
  const [selectedCityKey, setSelectedCityKey] = React.useState<string | null>(null);
  const [selectedSkuKey, setSelectedSkuKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    const cancelled = { value: false };
    void fetch(buildApiUrl('/api/sites/current'), { headers: publicSiteHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error(`site_config_${response.status}`);
        const json = (await response.json()) as ApiEnvelope<CurrentSiteData>;
        if (String(json.code) !== '0') throw new Error(json.msg || 'site_config_failed');
        return json.data ?? {};
      })
      .then((current) => {
        if (cancelled.value) return;
        setSite(current.site ?? null);
        setTenant(current.tenant ?? null);
        setLoadState('ready');
      })
      .catch(() => {
        if (cancelled.value) return;
        setSite(null);
        setTenant(null);
        setLoadState('error');
      });

    return () => {
      cancelled.value = true;
    };
  }, []);

  const brand: BrandConfig = { ...(site?.brandConfig ?? {}), ...(tenant?.brandConfig ?? {}) };
  const brandName = resolveBrandName([brand.name, brand.siteName, tenant?.name, site?.name]);
  const supportHref = brand.supportEmail ? `mailto:${brand.supportEmail}` : loginUrl;
  const countries = Array.isArray(brand.publicCountries) ? brand.publicCountries : [];
  const catalogGroups = React.useMemo(() => buildPublicCatalogGroups(countries), [countries]);
  const stats = React.useMemo(() => buildCatalogStats(catalogGroups), [catalogGroups]);
  const selectedCatalogGroup = getSelectedCatalogGroup(catalogGroups, selectedCountryKey) ?? catalogGroups[0] ?? null;
  const selectedCity = getSelectedCity(selectedCatalogGroup, selectedCityKey);
  const selectedSku = getSelectedSku(selectedCity, selectedSkuKey);
  const headerStatus = getPublicRegionValue(loadState, stats.countryCount);
  const statusCopy = getStatusCopy(loadState, stats);

  React.useEffect(() => {
    document.title = `${brandName} - 静态住宅代理价格与购买`;
  }, [brandName]);

  React.useEffect(() => {
    if (catalogGroups.length === 0) {
      setSelectedCountryKey(null);
      return;
    }
    const exists = selectedCountryKey ? catalogGroups.some((group) => group.key === selectedCountryKey) : false;
    if (!exists) setSelectedCountryKey(catalogGroups[0]!.key);
  }, [catalogGroups, selectedCountryKey]);

  React.useEffect(() => {
    if (!selectedCatalogGroup || selectedCatalogGroup.cityRows.length === 0) {
      setSelectedCityKey(null);
      return;
    }
    const exists = selectedCityKey ? selectedCatalogGroup.cityRows.some((city) => city.key === selectedCityKey) : false;
    if (!exists) setSelectedCityKey(selectedCatalogGroup.cityRows[0]!.key);
  }, [selectedCatalogGroup, selectedCityKey]);

  React.useEffect(() => {
    if (!selectedCity || selectedCity.skus.length === 0) {
      setSelectedSkuKey(null);
      return;
    }
    const exists = selectedSkuKey ? selectedCity.skus.some((sku) => sku.key === selectedSkuKey) : false;
    if (!exists) setSelectedSkuKey((getPreferredSku(selectedCity.skus) ?? selectedCity.skus[0])!.key);
  }, [selectedCity, selectedSkuKey]);

  return (
    <div className="ipipd-buy" style={brand.primaryColor ? ({ '--buy-primary': brand.primaryColor } as React.CSSProperties) : undefined}>
      <header className="buy-header">
        <a className="buy-brand" href="/" aria-label={`${brandName} 首页`}>
          <img src={brand.logoUrl || '/images/ipipd/logo.svg'} alt="" />
        </a>
        <nav className="buy-nav" aria-label="主导航">
          {navLinks.map(([label, href]) => (
            <a className={href === '/pricing' ? 'active' : undefined} href={href} key={href}>{label}</a>
          ))}
        </nav>
        <a className="buy-status" href={customerBuyUrl}>
          <span>静态住宅</span>
          <strong>{headerStatus}</strong>
        </a>
        <div className="buy-actions">
          <a className="buy-link" href={loginUrl}>登录</a>
          <a className="buy-btn buy-btn-ghost" href={registerUrl}>注册</a>
          <a className="buy-btn buy-btn-primary" href={customerBuyUrl}>立即购买</a>
          <button className="buy-menu" type="button" aria-label="打开导航" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
            <span />
            <span />
            <span />
          </button>
        </div>
        {menuOpen ? (
          <div className="buy-mobile-menu">
            {navLinks.map(([label, href]) => (
              <a href={href} key={href}>{label}</a>
            ))}
            <a href={loginUrl}>登录</a>
          </div>
        ) : null}
      </header>

      <main className="buy-main">
        <section className="buy-hero">
          <div className="buy-hero-bg">
            <img src="/images/ipipd/bg-top.avif" alt="" aria-hidden="true" />
          </div>
          <div className="buy-container buy-hero-inner">
            <h1>静态住宅代理价格与购买</h1>
            <div className="buy-hero-actions">
              <a className="buy-btn buy-btn-primary buy-btn-lg" href={customerBuyUrl}>立即购买</a>
              <a className="buy-btn buy-btn-ghost buy-btn-lg" href={supportHref}>咨询客服</a>
            </div>
          </div>
        </section>

        <section className="buy-console" aria-label="静态住宅购买工作台">
          <div className="buy-container buy-console-layout">
            <div className="buy-console-main">
              <div className="buy-console-head">
                <div>
                  <h2>国家、地区 分级选择</h2>
                </div>
                <div className="buy-live-status" role="status">
                  <span>{statusCopy.title}</span>
                  <strong>{statusCopy.value}</strong>
                </div>
              </div>

              {loadState === 'loading' ? (
                <LoadingCatalog />
              ) : loadState === 'error' ? (
                <EmptyCatalog
                  title="公开目录读取失败"
                  detail="当前无法读取站点公开资源目录，请刷新页面后重试，或登录后进入购买工作台查看。"
                  actionLabel="进入登录"
                  actionHref={loginUrl}
                />
              ) : catalogGroups.length === 0 ? (
                <EmptyCatalog
                  title="暂无公开地区数据"
                  detail="当前站点尚未公开可售国家和地区。登录后可在真实购买工作台查看账户可购买资源。"
                  actionLabel="进入购买工作台"
                  actionHref={customerBuyUrl}
                />
              ) : (
                <>
                  <div className="buy-stat-grid" aria-label="公开目录统计">
                    <StatCard label="国家/地区" value={formatNumber(stats.countryCount)} />
                    <StatCard label="具体地区" value={formatNumber(stats.cityCount)} />
                    <StatCard label="可选商品" value={formatNumber(stats.skuCount)} />
                    <StatCard label="可购买" value={formatNumber(stats.saleableCount)} />
                  </div>

                  <section className="buy-picker-card">
                    <div className="buy-card-title">
                      <h3>选择国家/地区</h3>
                    </div>
                    <div className="buy-country-grid" aria-label="国家地区列表">
                      {catalogGroups.map((group) => (
                        <button
                          className={selectedCatalogGroup?.key === group.key ? 'is-selected' : undefined}
                          key={group.key}
                          type="button"
                          onClick={() => {
                            setSelectedCountryKey(group.key);
                            setSelectedCityKey(null);
                            setSelectedSkuKey(null);
                          }}
                        >
                          <span className="buy-country-flag">{countryFlagEmoji(group.code)}</span>
                          <strong>{group.name}</strong>
                          <small>{group.cityCount > 0 ? `${group.cityCount} 个地区` : '登录后查看地区'}</small>
                          <em>{group.countLabel}</em>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="buy-picker-card">
                    <div className="buy-card-title buy-card-title-row">
                      <div>
                        <h3>{selectedCatalogGroup ? `${selectedCatalogGroup.name} 地区` : '具体地区'}</h3>
                      </div>
                      <a href={customerBuyUrl}>进入完整购买</a>
                    </div>

                    {selectedCatalogGroup && selectedCatalogGroup.cityRows.length > 0 ? (
                      <>
                        <div className="buy-city-tabs" aria-label="地区列表">
                          {selectedCatalogGroup.cityRows.map((city) => (
                            <button
                              className={selectedCity?.key === city.key ? 'is-selected' : undefined}
                              key={city.key}
                              type="button"
                              style={{ minHeight: 84 }}
                              onClick={() => {
                                setSelectedCityKey(city.key);
                                setSelectedSkuKey(null);
                              }}
                            >
                              <small>{selectedCatalogGroup.name}</small>
                              <strong>{city.name}</strong>
                              <span>{city.countLabel}</span>
                            </button>
                          ))}
                        </div>

                        {selectedCity && selectedCity.skus.length > 0 ? (
                          <div className="buy-line-grid" aria-label="商品列表">
                            {selectedCity.skus.map((sku) => (
                              <button
                                className={selectedSku?.key === sku.key ? `buy-line-card buy-line-${sku.status} is-selected` : `buy-line-card buy-line-${sku.status}`}
                                key={sku.key}
                                type="button"
                                style={{ minHeight: 168 }}
                                onClick={() => setSelectedSkuKey(sku.key)}
                              >
                                <div className="buy-line-top" style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
                                  <small>{selectedCatalogGroup.name} / {selectedCity.name}</small>
                                  <strong>{sku.label}</strong>
                                  <span>{sku.statusLabel}</span>
                                </div>
                                <div className="buy-line-meta">
                                  <span>{sku.providerLabel}</span>
                                  <span>{sku.stockLabel}</span>
                                </div>
                                <div className="buy-line-price">
                                  <small>30天</small>
                                  <b>{sku.priceLabel}</b>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                            <EmptyCatalog
                              compact
                              title="该地区暂未公开商品"
                              detail="公开目录没有暴露该地区的商品明细，登录后以真实购买工作台为准。"
                              actionLabel="登录查看"
                              actionHref={loginUrl}
                            />
                          )}
                      </>
                    ) : (
                      <EmptyCatalog
                        compact
                        title="该国家暂未公开地区"
                        detail="公开目录没有暴露地区明细，登录后可查看完整可购买资源。"
                        actionLabel="进入购买工作台"
                        actionHref={customerBuyUrl}
                      />
                    )}
                  </section>
                </>
              )}
            </div>

            <aside className="buy-summary" aria-label="订单摘要">
              <div className="buy-summary-card">
                <div className="buy-summary-head">
                  <span>订单信息</span>
                  <strong>30天</strong>
                </div>
                <SelectionRow label="国家/地区" value={selectedCatalogGroup?.name ?? '-'} />
                <SelectionRow label="具体地区" value={selectedCity?.name ?? '-'} />
                <SelectionRow label="分配方式" value={selectedSku?.label ?? '-'} />
                <SelectionRow label="供应平台" value={selectedSku?.providerLabel ?? '-'} />
                <SelectionRow label="资源状态" value={selectedSku?.statusLabel ?? '-'} />
                <div className="buy-summary-total">
                  <span>预估价格</span>
                  <strong>{selectedSku?.priceLabel ?? '登录后报价'}</strong>
                </div>
                <a className="buy-btn buy-btn-primary buy-summary-submit" href={customerBuyUrl}>
                  {selectedSku?.status === 'unsaleable' ? '登录查看可用商品' : '立即购买'}
                </a>
              </div>
            </aside>
          </div>
        </section>
      </main>

      <footer className="buy-footer">
        <div className="buy-container buy-footer-inner">
          <div className="buy-footer-brand">
            <img src={brand.logoUrl || '/images/ipipd/logo.svg'} alt="" />
            <p>{brand.footerText || '全球静态住宅代理资源，按国家和地区清晰选择。'}</p>
          </div>
          <div className="buy-footer-links">
            <a href="/pricing">静态住宅</a>
            <a href="/products/dynamic">动态住宅</a>
            <a href="/faq">帮助中心</a>
            <a href={supportHref}>联系我们</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="buy-stat-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function SelectionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="buy-selection-row" style={{ display: 'grid', gap: 4 }}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LoadingCatalog() {
  return (
    <div className="buy-loading" role="status">
      <div />
      <div />
      <div />
      <div />
      <span>正在读取公开资源目录</span>
    </div>
  );
}

function EmptyCatalog({ actionHref, actionLabel, compact, detail, title }: { actionHref: string; actionLabel: string; compact?: boolean; detail: string; title: string }) {
  return (
    <div className={compact ? 'buy-empty buy-empty-compact' : 'buy-empty'} role="status">
      <strong>{title}</strong>
      <p>{detail}</p>
      <a className="buy-btn buy-btn-primary" href={actionHref}>{actionLabel}</a>
    </div>
  );
}

function buildPublicCatalogGroups(countries: PublicCountry[]): PublicCatalogGroup[] {
  return countries.map((country, countryIndex) => {
    const code = normalizeCountryCode(country.countryCode);
    const countryName = formatCountryName(country.countryName, code);
    const cityRows = getCityItems(country).map((city, cityIndex) => {
      const rawCityName = city.cityName || city.name || city.cityCode;
      const cityName = formatCityName(rawCityName, countryName, cityIndex);
      const skus = getSkuItems(city).map((sku, skuIndex) => formatPublicSku(sku, {
        countryCode: code,
        countryName,
        cityName,
        index: skuIndex,
      }));
      const count = getPublicCount(city, skus.length > 0 ? skus.length : null);
      return buildCatalogCity({
        countryIndex,
        cityIndex,
        name: cityName,
        count,
        skus,
      });
    });

    const countrySkus = getSkuItems(country);
    if (countrySkus.length > 0) {
      const grouped = groupCountryLevelSkus(countrySkus, countryName, code);
      grouped.forEach((city, index) => {
        cityRows.push(buildCatalogCity({
          countryIndex,
          cityIndex: cityRows.length + index,
          name: city.name,
          count: city.skus.length,
          skus: city.skus,
        }));
      });
    }

    const knownSkuCount = cityRows.reduce((sum, city) => sum + (city.skuCount ?? 0), 0);
    const countryCount = getPublicCount(country, knownSkuCount > 0 ? knownSkuCount : null);
    const saleableCount = cityRows.reduce((sum, city) => sum + city.saleableCount, 0);
    return {
      cityCount: cityRows.length,
      cityRows,
      code,
      countLabel: formatNullableCount(countryCount),
      key: `country-${code || countryName}-${countryIndex}`,
      name: countryName,
      saleableCount,
      skuCount: countryCount,
    };
  });
}

function buildCatalogCity(input: { count: number | null; countryIndex: number; cityIndex: number; name: string; skus: PublicCatalogSku[] }): PublicCatalogCity {
  return {
    countLabel: formatNullableCount(input.count),
    key: `city-${input.countryIndex}-${input.name}-${input.cityIndex}`,
    name: input.name,
    saleableCount: input.skus.filter((sku) => sku.status === 'saleable').length,
    skuCount: input.count,
    skus: input.skus,
  };
}

function groupCountryLevelSkus(skus: PublicSku[], countryName: string, countryCode?: string): Array<{ name: string; skus: PublicCatalogSku[] }> {
  const groups = new Map<string, PublicCatalogSku[]>();
  skus.forEach((sku, index) => {
    const cityName = inferSkuCityName(sku, countryName, countryCode, index);
    const formatted = formatPublicSku(sku, {
      countryCode,
      countryName,
      cityName,
      index,
    });
    groups.set(cityName, [...(groups.get(cityName) ?? []), formatted]);
  });
  return [...groups.entries()].map(([name, groupSkus]) => ({ name, skus: groupSkus }));
}

function getCityItems(country: PublicCountry): PublicCity[] {
  return Array.isArray(country.cities) ? country.cities : [];
}

function getSkuItems(source: PublicCountry | PublicCity): PublicSku[] {
  const fromResources = Array.isArray(source.resources) ? source.resources : [];
  const fromSkus = Array.isArray(source.skus) ? source.skus : [];
  const fromItems = Array.isArray(source.items) ? source.items : [];
  return [...fromResources, ...fromSkus, ...fromItems];
}

function formatPublicSku(
  sku: PublicSku,
  context: { cityName: string; countryCode?: string; countryName: string; index: number },
): PublicCatalogSku {
  const location = formatResourceLocationZh({
    code: sku.code || sku.upstreamResourceId || sku.displayName || sku.lineName || sku.name || undefined,
    countryCode: context.countryCode,
    name: sku.name,
    displayName: sku.displayName,
    upstreamResourceId: sku.upstreamResourceId,
    providerCode: sku.providerCode,
  });
  const status = getSkuSaleStatus(sku);
  return {
    key: sku.id || sku.code || sku.upstreamResourceId || `${context.cityName}-${context.index}`,
    label: location.line ?? location.detail ?? location.country,
    priceLabel: formatPriceLabel(sku),
    providerLabel: formatPublicProviderLabel(sku.providerCode),
    status,
    statusLabel: status === 'saleable' ? '可购买' : status === 'unsaleable' ? '暂不可售' : '登录确认',
    stockLabel: formatStockLabel(sku, status),
  };
}

function getSkuSaleStatus(sku: PublicSku): PublicCatalogSku['status'] {
  if (typeof sku.isSaleable === 'boolean') return sku.isSaleable ? 'saleable' : 'unsaleable';
  if (typeof sku.saleable === 'boolean') return sku.saleable ? 'saleable' : 'unsaleable';
  const status = sku.status?.trim().toUpperCase();
  if (status) {
    if (['ACTIVE', 'ENABLED', 'SALEABLE', 'AVAILABLE', 'ONLINE'].includes(status)) return 'saleable';
    if (['DISABLED', 'HIDDEN', 'INACTIVE', 'UNSALEABLE', 'UNAVAILABLE', 'OFFLINE'].includes(status)) return 'unsaleable';
  }
  return hasPublicPrice(sku) ? 'saleable' : 'unknown';
}

function getPublicCount(source: PublicCountry | PublicCity, derived: number | null): number | null {
  if (typeof source.availableQuantity === 'number') return source.availableQuantity;
  if (typeof source.resources === 'number') return source.resources;
  return derived;
}

function buildCatalogStats(groups: PublicCatalogGroup[]): CatalogStats {
  return groups.reduce<CatalogStats>(
    (stats, group) => ({
      cityCount: stats.cityCount + group.cityCount,
      countryCount: stats.countryCount + 1,
      saleableCount: stats.saleableCount + group.saleableCount,
      skuCount: stats.skuCount + (group.skuCount ?? group.cityRows.reduce((sum, city) => sum + (city.skuCount ?? city.skus.length), 0)),
    }),
    { cityCount: 0, countryCount: 0, saleableCount: 0, skuCount: 0 },
  );
}

function getSelectedCatalogGroup(groups: PublicCatalogGroup[], selectedKey: string | null): PublicCatalogGroup | null {
  if (!selectedKey) return null;
  return groups.find((group) => group.key === selectedKey) ?? null;
}

function getSelectedCity(group: PublicCatalogGroup | null, selectedKey: string | null): PublicCatalogCity | null {
  if (!group) return null;
  if (!selectedKey) return group.cityRows[0] ?? null;
  return group.cityRows.find((city) => city.key === selectedKey) ?? group.cityRows[0] ?? null;
}

function getSelectedSku(city: PublicCatalogCity | null, selectedKey: string | null): PublicCatalogSku | null {
  if (!city) return null;
  if (!selectedKey) return getPreferredSku(city.skus);
  return city.skus.find((sku) => sku.key === selectedKey) ?? getPreferredSku(city.skus);
}

function getPreferredSku(skus: PublicCatalogSku[]): PublicCatalogSku | null {
  return skus.find((sku) => sku.status === 'saleable') ?? skus[0] ?? null;
}

function formatNullableCount(count: number | null): string {
  return typeof count === 'number' ? `${count} 条资源` : '登录后查看';
}

function formatNumber(value: number): string {
  return value > 0 ? String(value) : '-';
}

function getStatusCopy(loadState: SiteLoadState, stats: CatalogStats): { detail: string; title: string; value: string } {
  if (loadState === 'loading') return { title: '公开目录', value: '加载中', detail: '正在读取站点公开资源目录。' };
  if (loadState === 'error') return { title: '公开目录', value: '不可用', detail: '公开资源目录读取失败，登录后仍可进入购买工作台查看账户权限内资源。' };
  if (stats.countryCount > 0) {
    return {
      title: '公开目录',
      value: `${stats.countryCount} 个地区`,
      detail: '公开目录按国家和地区组织，登录后继续生成实时报价。',
    };
  }
  return { title: '公开目录', value: '暂无', detail: '当前站点未公开可售国家和地区，登录后以购买工作台为准。' };
}

function getPublicRegionValue(loadState: SiteLoadState, countryCount: number): string {
  if (loadState === 'loading') return '加载中';
  if (loadState === 'error') return '待登录查看';
  if (countryCount > 0) return `${countryCount} 个地区`;
  return '登录后查看';
}

function formatCountryName(countryName?: string, countryCode?: string): string {
  const trimmed = countryName?.trim();
  if (trimmed && containsChinese(trimmed)) return trimmed;
  const normalizedCode = normalizeCountryCode(countryCode);
  if (normalizedCode && COUNTRY_NAME_ZH[normalizedCode]) return COUNTRY_NAME_ZH[normalizedCode];
  if (trimmed) {
    const phrase = normalizePhrase(trimmed);
    if (COUNTRY_PHRASE_ZH[phrase]) return COUNTRY_PHRASE_ZH[phrase];
  }
  const displayName = normalizedCode ? displayCountryName(normalizedCode) : null;
  return displayName || normalizedCode || '未知地区';
}

function formatCityName(rawName: string | undefined, countryName: string, _index: number): string {
  const trimmed = rawName?.trim();
  if (!trimmed) return countryName;
  if (containsChinese(trimmed)) return stripGenericLineWords(trimmed) || trimmed;
  const translated = translateCityText(trimmed);
  if (translated && translated !== countryName) return translated;
  if (translated === countryName) return translated;
  return countryName;
}

function inferSkuCityName(sku: PublicSku, countryName: string, countryCode: string | undefined, _index: number): string {
  const candidates = [sku.displayName, sku.lineName, sku.name, sku.code, sku.upstreamResourceId];
  for (const candidate of candidates) {
    const location = formatResourceLocationZh({
      code: candidate ?? undefined,
      countryCode,
      name: sku.name,
      displayName: sku.displayName,
      upstreamResourceId: sku.upstreamResourceId,
      providerCode: sku.providerCode,
    });
    if (location.city) return location.city;
    if (location.detail && location.detail !== countryName) return location.detail;
  }
  return countryName;
}

function formatPriceLabel(sku: PublicSku): string {
  const value = sku.unitPrice?.trim();
  return value ? value : '登录后报价';
}

function formatStockLabel(sku: PublicSku, status: PublicCatalogSku['status']): string {
  if (status === 'unsaleable') return '暂不可售';
  const stock = typeof sku.stock === 'number' ? sku.stock : typeof sku.availableQuantity === 'number' ? sku.availableQuantity : null;
  if (typeof stock === 'number' && stock > 0) return `${stock} 个可用`;
  return '实时确认';
}

function hasPublicPrice(sku: PublicSku): boolean {
  return Boolean(sku.unitPrice?.trim());
}

function normalizeCountryCode(value?: string | null): string | undefined {
  const raw = value?.trim().toUpperCase();
  if (!raw) return undefined;
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  const separated = raw.split(/[:_\-\s]/)[0];
  if (separated && /^[A-Z]{2}$/.test(separated)) return separated;
  return undefined;
}

function normalizePhrase(value: string): string {
  return value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toUpperCase();
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function displayCountryName(code: string): string | null {
  try {
    zhRegionNames ??= new Intl.DisplayNames(['zh-CN'], { type: 'region' });
    return zhRegionNames.of(code) ?? null;
  } catch {
    return null;
  }
}

function translateCityText(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (containsChinese(text)) return stripGenericLineWords(text) || text;
  const compactUs = parseUsProviderLine(text, normalizeCountryCode(text));
  if (compactUs?.city) return compactUs.city;

  const phrase = normalizePhrase(text);
  if (CITY_PHRASE_ZH[phrase]) return CITY_PHRASE_ZH[phrase];
  const tokens = phrase.split(' ').filter(Boolean);
  for (let size = Math.min(4, tokens.length); size >= 1; size -= 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const candidate = tokens.slice(index, index + size).join(' ');
      if (CITY_PHRASE_ZH[candidate]) return CITY_PHRASE_ZH[candidate];
      if (CITY_CODE_ZH[candidate]) return CITY_CODE_ZH[candidate];
    }
  }
  return null;
}

function parseUsProviderLine(value?: string | null, countryCode?: string): { city?: string; line?: string; state?: string } | null {
  const raw = value?.trim().toUpperCase();
  if (!raw) return null;
  const country = countryCode ?? normalizeCountryCode(raw);
  if (country && country !== 'US') return null;
  const tail = raw.split(/[:_\-/\s]+/).find((part) => /^USA[A-Z0-9]+$/.test(part)) ?? raw.replace(/[^A-Z0-9]/g, '');
  const match = tail.match(/^USA([A-Z]{3})([A-Z]{3})([A-Z0-9]*)$/);
  if (!match) return null;
  const state = US_STATE_NAME_ZH[match[1] ?? ''];
  const city = CITY_CODE_ZH[match[2] ?? ''];
  const suffix = match[3] ? LINE_QUALIFIER_ZH[match[3]] : undefined;
  return state || city || suffix ? { state, city, line: suffix } : null;
}

function stripGenericLineWords(value: string): string {
  return value
    .split(/[\s:_\-/]+/)
    .filter((token) => !IGNORED_LINE_TOKENS.has(token.toUpperCase()))
    .join('-')
    .trim();
}

function countryFlagEmoji(countryCode?: string): string {
  const code = countryCode?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code)) return '地区';
  return String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)));
}
