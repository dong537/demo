import React from 'react';
import { ApiOutlined, CustomerServiceOutlined, UserOutlined, WechatOutlined } from '@ant-design/icons';
import './home.css';
import { buildApiUrl, publicSiteHeaders } from '../../shared/api/client';
import { formatRegionNameZh, formatResourceLocationZh } from '../../shared/resource/resource-labels';
import { resolveBrandName } from '../../shared/site/brand-display';

interface PublicCountry {
  countryCode?: string;
  countryName?: string;
  availableQuantity?: number;
  cities?: PublicCity[];
}

interface PublicCity {
  cityCode?: string;
  cityName?: string;
  name?: string;
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

const loginUrl = '/login';
const registerUrl = '/register';
const buyUrl = '/buy';

const navItems = [
  { label: '首页', href: '/', active: true },
  { label: '购买', href: '/pricing' },
  { label: '动态住宅', href: '/products/dynamic' },
  { label: '教程', href: '/tutorials' },
  { label: '推广返佣', href: '/promotion' },
  { label: '帮助中心', href: '/faq' },
];

const heroHighlights = [
  { icon: '/images/ipipd/top-star.svg', title: '100%独立IP', detail: '纯净原生' },
  { icon: '/images/ipipd/top-modem.svg', title: '智能筛选', detail: '低风控零污染' },
  { icon: '/images/ipipd/top-rotate.svg', title: '7x24小时', detail: '企业级稳定保障' },
  { icon: '/images/ipipd/top-airplane.svg', title: '200+国家覆盖', detail: '提升跨境业务转化' },
];

const contactItems = [
  { label: '联系客服', Icon: CustomerServiceOutlined },
  { label: '资源对接', Icon: ApiOutlined },
  { label: '客户经理', Icon: UserOutlined },
  { label: '商务微信', Icon: WechatOutlined },
];

const whyTabs = ['100%真实住宅IP', '高成功率', '稳定可靠', '快速接入', '全球覆盖'];

const productSolutions = [
  {
    title: '静态住宅IP',
    badge: '稳定业务需求',
    description: '长期稳定运营的最佳选择，适合登录、账号环境、店铺和广告业务。',
    fit: '长期登录 / 社媒养号 / 跨境店铺 / 广告投放',
    action: '查看实时价格',
    href: buyUrl,
    features: ['长期固定IP', '高纯净住宅网络', '低风控更稳定', '支持独享使用'],
  },
  {
    title: '动态住宅IP',
    badge: '高并发业务',
    description: '面向批量任务、数据采集和多地区访问验证，适合规模化业务咨询。',
    fit: '数据采集 / 账号矩阵 / 批量操作 / 市场调研',
    action: '了解动态住宅',
    href: '/products/dynamic',
    features: ['轮换IP池', '自动切换节点', '国家城市筛选', '高匿名代理'],
  },
];

const useCases = [
  {
    title: '跨境电商',
    badge: '静态IP',
    description: '多店铺运营、账号注册、订单监控、防关联登录。',
    features: ['账号安全防关联', '多店铺统一管控', '订单实时监控'],
  },
  {
    title: '社交媒体运营',
    badge: '静态IP',
    description: 'TikTok、Facebook、Instagram 多账号矩阵运营。',
    features: ['账号隔离', '矩阵定位', '统一内容管理'],
  },
  {
    title: '自动化脚本',
    badge: '动态IP',
    description: 'RPA 自动化任务、批量操作、程序部署。',
    features: ['流程自动化', '批量处理', '稳定部署'],
  },
  {
    title: '竞品分析',
    badge: '动态IP',
    description: '市场调研、价格监控、用户行为采集。',
    features: ['竞品分析', '价格监控', '行为采集'],
  },
  {
    title: '数据洞察',
    badge: '动态IP',
    description: '搜索引擎采集、电商数据抓取、公开信息采集。',
    features: ['搜索采集', '电商抓取', '公开数据'],
  },
  {
    title: '广告验证',
    badge: '静态IP',
    description: '广告地区投放测试、落地页检测、反作弊验证。',
    features: ['地区测试', '落地页检测', '流量验证'],
  },
];

const capabilities = [
  ['极致稳定网络', '真实住宅 IP 池，按国家和城市组织资源，支撑长期业务环境。'],
  ['智能资源调度', '按上游资源、库存状态和业务需求自动匹配合适商品，降低无效连接。'],
  ['透明价格配置', '价格由后台资源和全局价格中心决定，购买页按真实报价提交订单。'],
  ['专业客户支持', '通过登录后的工单、订单、代理检测和后台记录完成问题追踪。'],
] as const;

const faqItems = [
  {
    q: '我可以使用 ipmigo 代理翻墙吗？',
    a: '不可以。平台提供的是海外静态住宅 IP 服务，并非翻墙工具。所有资源仅适用于合规的境外网络业务环境。',
  },
  {
    q: '没有登录能直接下单吗？',
    a: '不能。点击购买会先进入登录页，登录后再使用真实资源、真实报价和真实订单流程完成购买。',
  },
  {
    q: '购买页会显示真实国家和城市吗？',
    a: '会。可售资源按后台已上架商品展示，国家、城市、商品和价格以真实后端数据为准。',
  },
  {
    q: '代理连接不上应该怎么排查？',
    a: '优先检查境外网络环境、协议类型、白名单、账号密码、端口和目标平台限制，再通过代理检测和工单记录定位问题。',
  },
];

export function PublicHomePage() {
  const [site, setSite] = React.useState<PublicSite | null>(null);
  const [tenant, setTenant] = React.useState<PublicTenant | null>(null);
  const [loadState, setLoadState] = React.useState<SiteLoadState>('loading');
  const [activeTab, setActiveTab] = React.useState(0);
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    const cancelled = { value: false };
    void fetch(buildApiUrl('/api/sites/current'), { headers: publicSiteHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error(`site_config_${response.status}`);
        const json = (await response.json()) as ApiEnvelope<CurrentSiteData>;
        if (json.code !== 0) throw new Error(json.msg || 'site_config_failed');
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
        setLoadState('error');
      });

    return () => {
      cancelled.value = true;
    };
  }, []);

  const brand = { ...(site?.brandConfig ?? {}), ...(tenant?.brandConfig ?? {}) };
  const brandName = resolveBrandName([brand.name, brand.siteName, tenant?.name, site?.name]);
  const countries = Array.isArray(brand.publicCountries) ? brand.publicCountries : [];
  const supportHref = brand.supportEmail ? `mailto:${brand.supportEmail}` : loginUrl;

  React.useEffect(() => {
    document.title = `${brandName} - 全球静态原生住宅代理`;
  }, [brandName]);

  return (
    <div className="ipipd-home" style={brand.primaryColor ? ({ '--home-primary': brand.primaryColor } as React.CSSProperties) : undefined}>
      <header className="home-header">
        <a className="home-brand" href="/" aria-label={`${brandName} 首页`}>
          <img src={brand.logoUrl || '/images/ipipd/logo.svg'} alt={brandName} />
        </a>
        <nav className="home-nav" aria-label="主导航">
          {navItems.map((item) => (
            <a key={item.label} className={item.active ? 'active' : undefined} href={item.href}>{item.label}</a>
          ))}
        </nav>
        <div className="home-actions">
          <span className="home-language">简体中文⌄</span>
          <a className="home-btn home-btn-outline home-btn-auth" href={loginUrl}>登录</a>
          <a className="home-btn home-btn-primary" href={registerUrl}>注册</a>
          <button className="home-menu" type="button" aria-label="菜单" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
            <span />
            <span />
            <span />
          </button>
        </div>
        {menuOpen ? (
          <div className="home-mobile-menu">
            {navItems.map((item) => (
              <a key={item.label} href={item.href}>{item.label}</a>
            ))}
            <a href={loginUrl}>登录</a>
          </div>
        ) : null}
      </header>

      <aside className="home-contact-dock" aria-label="联系入口">
        {contactItems.map(({ label, Icon }) => (
          <a key={label} href={supportHref}>
            <Icon aria-hidden="true" />
            <strong>{label}</strong>
          </a>
        ))}
      </aside>

      <main className="home-main">
        <section className="home-hero">
          <img className="home-hero-bg" src="/images/ipipd/bg-top.avif" alt="" aria-hidden="true" />
          <div className="home-container home-hero-inner">
            <div className="home-badge">
              <img src="/images/ipipd/img-flower.svg" alt="" aria-hidden="true" />
              <span>500万用户的选择</span>
              <img src="/images/ipipd/img-flower.svg" alt="" aria-hidden="true" />
            </div>
            <h1>
              <span>全球原生住宅IP</span>
              <strong>动静态全覆盖</strong>
            </h1>
            <p>精准覆盖200+国家，提供静态及动态IP，灵活应对多种业务场景</p>
            <div className="home-hero-actions">
              <a className="home-btn home-btn-primary home-btn-xl" href={loginUrl}>免费试用</a>
              <a className="home-btn home-btn-outline home-btn-xl" href={buyUrl}>查看套餐</a>
            </div>
            <div className="home-hero-features" aria-label="核心能力">
              {heroHighlights.map((item) => (
                <article key={item.title}>
                  <img src={item.icon} alt="" aria-hidden="true" />
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="home-scroll-cue" aria-hidden="true">
          <span>⌄</span>
        </section>

        <section className="home-section home-section-surface" id="why">
          <div className="home-container">
            <SectionHeading title="为什么选择 ipmigo" detail="精准覆盖220+国家，提供静态及动态IP，灵活应对多种业务场景" />
            <div className="home-tabs">
              {whyTabs.map((tab, index) => (
                <button key={tab} type="button" aria-pressed={index === activeTab} className={index === activeTab ? 'active' : ''} onClick={() => setActiveTab(index)}>
                  {tab}
                </button>
              ))}
            </div>
            <div className="home-why-panel">
              <div className="home-why-copy">
                <h3>
                  <span>{String(activeTab + 1).padStart(2, '0')}</span>
                  {whyCopy(activeTab).title}
                </h3>
                <ul>
                  {whyCopy(activeTab).items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="home-why-visual">
                <img src="/images/ipipd/world.avif" alt="全球住宅代理覆盖示意图" />
              </div>
            </div>
          </div>
        </section>

        <section className="home-section">
          <div className="home-container">
            <SectionHeading title="满足任何需求的代理解决方案" />
            <div className="home-product-grid">
              {productSolutions.map((product) => (
                <article className="home-product-card" key={product.title}>
                  <div>
                    <span>{product.title}</span>
                    <h3>{product.description}</h3>
                  </div>
                  <ul>
                    {product.features.map((feature) => <li key={feature}>{feature}</li>)}
                  </ul>
                  <p>{product.fit}</p>
                  <div className="home-product-footer">
                    <strong>适用于【{product.badge}】</strong>
                    <a className="home-btn home-btn-primary" href={product.href}>{product.action}</a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section home-section-surface" id="coverage">
          <div className="home-container home-pool">
            <div>
              <SectionHeading align="left" title="全球代理池，轻松访问公共数据" detail="ipmigo 帮助团队按国家和城市选择代理资源，购买前以真实后台资源和报价为准。" />
              <div className="home-pool-stats">
                <article>
                  <span>公开地区</span>
                  <strong>{loadState === 'ready' ? `${countries.length}` : loadState === 'loading' ? '读取中' : '不可用'}</strong>
                </article>
                <article>
                  <span>资源来源</span>
                  <strong>真实上游</strong>
                </article>
                <article>
                  <span>交付链路</span>
                  <strong>可追踪</strong>
                </article>
              </div>
            </div>
            {countries.length > 0 ? (
              <div className="home-country-grid">
                {countries.slice(0, 8).map((country) => (
                  <article key={country.countryCode || country.countryName || 'country'}>
                    <span>{formatPublicCountryName(country)}</span>
                    <strong>{formatCities(country)}</strong>
                    <em>{typeof country.availableQuantity === 'number' ? `${country.availableQuantity} 条` : '可售'}</em>
                  </article>
                ))}
              </div>
            ) : (
              <div className="home-empty-state">
                <strong>{loadState === 'error' ? '公开配置读取失败' : '暂无公开地区数据'}</strong>
                <p>{loadState === 'error' ? '请稍后刷新页面重试。' : '站点尚未暴露可公开的国家和城市信息，登录后以购买页资源为准。'}</p>
              </div>
            )}
          </div>
        </section>

        <section className="home-section" id="solutions">
          <div className="home-container">
            <SectionHeading title="适用所有场景的最佳代理" />
            <div className="home-use-grid">
              {useCases.map((item) => (
                <article key={item.title}>
                  <span>{item.badge}</span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <ul>
                    {item.features.map((feature) => <li key={feature}>{feature}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section home-section-surface">
          <div className="home-container">
            <SectionHeading title="具备覆盖全行业的能力与经验" />
            <div className="home-capability-grid">
              {capabilities.map(([title, description]) => (
                <article key={title}>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section" id="faq">
          <div className="home-container home-faq-layout">
            <SectionHeading align="left" title="经常遇到的问题" detail="购买、使用和排障都以真实订单、代理检测和后台记录为准。" />
            <div className="home-faq-list">
              {faqItems.map((item, index) => (
                <details key={item.q} open={index === 0}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="home-cta">
          <div className="home-container">
            <h2>立即开启代理服务</h2>
            <p>全球住宅 IP 资源、真实购买流程、订单交付和售后记录统一管理。</p>
            <a className="home-btn home-btn-primary home-btn-xl" href={buyUrl}>进入购买</a>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-container home-footer-grid">
          <div className="home-footer-brand">
            <img src={brand.logoUrl || '/images/ipipd/logo.svg'} alt={brandName} />
            <p>{brand.footerText || '提供真实上游资源同步、实时价格和订单交付的专业住宅代理平台。'}</p>
          </div>
          <div>
            <strong>关于我们</strong>
            <a href="/about">品牌介绍</a>
            <a href="/promotion">推广返佣</a>
            <a href="/tutorials">使用教程</a>
          </div>
          <div>
            <strong>代理产品</strong>
            <a href="/buy">静态住宅代理</a>
            <a href="/products/dynamic">动态住宅代理</a>
            <a href="/faq">代理 IP FAQ</a>
          </div>
          <div>
            <strong>法律声明</strong>
            <a href="/user-agreement">用户服务协议</a>
            <a href="/privacy-policy">用户隐私协议</a>
            <a href="/refund-policy">退款协议</a>
          </div>
        </div>
        <div className="home-container home-footer-bottom">
          <span>{`© ${new Date().getFullYear()} ${brandName}. 保留所有权利。`}</span>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ align = 'center', title, detail }: { align?: 'center' | 'left'; title: string; detail?: string }) {
  return (
    <div className={`home-section-heading ${align === 'left' ? 'align-left' : ''}`}>
      <h2>{title}</h2>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

function formatCities(country: PublicCountry) {
  const cities = (country.cities ?? [])
    .map((city) => formatPublicCityName(country, city))
    .filter((city) => city && city !== '未知地区');
  return cities.length > 0 ? cities.slice(0, 3).join(' / ') : '按国家展开';
}

function formatPublicCountryName(country: PublicCountry): string {
  const name = formatRegionNameZh({ countryCode: country.countryCode, code: country.countryCode });
  return name === '-' || name === '未知地区' ? '地区' : name;
}

function formatPublicCityName(country: PublicCountry, city: PublicCity): string | null {
  const location = formatResourceLocationZh({
    code: city.cityCode || city.name || city.cityName || country.countryCode,
    countryCode: country.countryCode,
    name: city.cityName || city.name || city.cityCode,
    displayName: city.cityName || city.name || city.cityCode,
    upstreamResourceId: city.cityCode || city.name || city.cityName,
  });
  return location.city ?? location.line ?? location.detail ?? null;
}

function whyCopy(index: number): { items: string[]; title: string } {
  const copies = [
    {
      title: '真实ISP家庭宽带住宅IP，非机房代理IP，降低平台识别风险',
      items: ['所有IP来自海外本地家庭宽带，更接近普通用户真实上网行为。', '相比机房代理IP，更不容易触发验证码、异常登录和环境检测。', '部分地区支持原生住宅IP，网络信誉度更高。'],
    },
    {
      title: '更高请求通过率，支撑登录、注册、采集与验证任务稳定完成',
      items: ['基于资源质量与使用表现筛选代理资源，减少无效连接。', '静态IP适合长期账号环境，动态IP适合高并发轮换任务。', '清晰的产品分层和可用地区选择，让团队更快找到合适代理方案。'],
    },
    {
      title: '稳定资源与长期会话能力，适合需要持续在线的核心业务',
      items: ['静态住宅IP支持长期固定出口，适合店铺、社媒和广告账户。', '持续关注资源可用性和节点质量，降低业务抖动风险。', '多国家和城市资源可以支撑多市场并行运营。'],
    },
    {
      title: '简单配置即可接入业务系统，兼容常见代理使用方式',
      items: ['兼容HTTP、HTTPS、Socks5等常见协议。', '购买、续费、提取和使用情况集中管理。', '适配浏览器、工具、客户端和自动化系统。'],
    },
    {
      title: '覆盖多国家与城市资源，满足跨境业务的地区化访问需求',
      items: ['支持北美、欧洲、东南亚等热门地区资源。', '按产品能力支持国家、城市等维度筛选。', '随着业务增长可按地区和任务规模扩充代理资源。'],
    },
  ];

  return copies[index] ?? copies[0];
}
