import './official-pages.css';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  articleHref,
  categoryHref,
  faqHref,
  findFaqTopic,
  newsArticles,
  newsCategories,
  tutorialCategoryGroups,
} from './public-content';
import { PublicBuyPage } from './buy';

type TextCard = readonly [title: string, description: string, icon?: string];
type FaqCard = readonly [title: string, description: string, icon: string, href?: string];

const promotionFeatures: TextCard[] = [
  ['高额返佣', '10%直享现金返佣', '/images/ipipd/img-flower.svg'],
  ['永久收益', '一次绑定，永久收益，上不封顶', '/images/ipipd/top-rotate.svg'],
  ['快速结算', '支付宝直接提现，实时结算', '/images/ipipd/top-airplane.svg'],
  ['全程支持', '专人辅导，售后无忧，轻松推广', '/images/ipipd/top-star.svg'],
];

const promotionModes: Array<{
  title: string;
  icon: string;
  action: string;
  items: string[];
}> = [
  {
    title: '返佣模式',
    icon: '/images/ipipd/model-rebate.svg',
    action: '立即申请',
    items: ['无预充，门槛低，按官网价返佣', '用专属链接推广，操作便捷', '10%佣金，返佣无上限', '微信/支付宝提现，24小时到账'],
  },
  {
    title: '转售服务商模式',
    icon: '/images/ipipd/model-service.svg',
    action: '立即咨询',
    items: ['阶梯式预充，享阶梯式代理价，自买自提', '低价拿货赚差价，适合个人运营销售，私域转化', '无需搭平台，聚焦采销对接，流程简单', '借助产品体系，轻资产快速开展转售'],
  },
  {
    title: '分站模式',
    icon: '/images/ipipd/model-station.svg',
    action: '了解合作',
    items: ['为您提供专属分站，可运营自己品牌', '阶梯式预充，享阶梯式代理价', '自主定价，适配不同客群，灵活盈利', '客户在专属分站自主下单，自主掌控全流程'],
  },
  {
    title: '接口对接模式',
    icon: '/images/ipipd/model-api.svg',
    action: '立即加入',
    items: ['产品支持接口对接自己的网站', '自主运营，自主掌控全流程', '全流程配备专业技术团队支持'],
  },
];

const faqCategories: FaqCard[] = [
  ['新手入门', '了解代理 IP、住宅代理、IP 池、纯净度和基础使用概念。', '问'],
  ['产品选择', '判断动态住宅代理、静态住宅 IP 和企业定制方案怎么选。', '选', faqHref('proxy-selection')],
  ['购买与计费', '查看试用、余额、套餐、流量计费、续费和发票相关问题。', '购'],
  ['协议与认证', '理解 HTTP、HTTPS、Socks5、白名单和账号密码认证。', '认'],
  ['配置教程', '找到浏览器、指纹浏览器、客户端和接口接入的配置方向。', '配'],
  ['故障排查', '排查连接失败、速度慢、地区不一致、认证失败等常见问题。', '查'],
  ['接口集成', '了解代理提取、接口接入、自动化任务和批量管理方式。', '接'],
  ['使用场景', '按社媒、电商、采集、广告验证、SEO 监控等场景找答案。', '用', faqHref('use-cases')],
  ['代理术语', '解释住宅地址、地址池、白名单、Socks5、接口提取等常用术语。', '词'],
  ['联系客服', '没有找到答案时，登录后提交工单或联系顾问按业务场景确认方案。', '客', '/login'],
];

const faqGuideSections = [
  {
    id: 'start',
    title: '先把基础问题排清',
    description: '适合刚开始了解 ipmigo，或准备第一次购买代理资源的用户。',
    items: faqCategories.slice(0, 3),
  },
  {
    id: 'connect',
    title: '配置、认证与故障排查',
    description: '围绕协议、白名单、客户端、浏览器和连接异常快速定位。',
    items: faqCategories.slice(3, 7),
  },
  {
    id: 'scenario',
    title: '按业务场景找答案',
    description: '把社媒、电商、采集、广告验证和常用术语收拢到可执行的教程里。',
    items: faqCategories.slice(7),
  },
];

const faqProxySelectionSections: TextCard[] = [
  ['看稳定身份还是轮换能力', '静态住宅代理更适合长期登录、账号环境、固定地区访问和需要稳定身份的业务；动态住宅代理更适合多次请求、分散访问和需要轮换出口的任务。'],
  ['看地区粒度和业务风险', '如果业务要求国家、城市、线路长期一致，应优先选择静态资源并核对后台真实库存；如果只需要地区大致覆盖，可以评估动态资源和轮换策略。'],
  ['看成本和失败成本', '低价代理不一定更便宜。账号异常、地区不准、连接失败、重复验证和人工排查都会增加实际成本。购买前应先用真实报价和订单履约记录核验。'],
  ['看协议和接入方式', 'HTTP、HTTPS、Socks5、白名单和账号密码认证要和业务工具匹配。指纹浏览器、客户端、脚本任务和接口接入的配置方式不同，不能混用。'],
  ['看售后排查路径', '可靠的代理方案需要能追踪订单、代理、地区、线路、账号、端口和有效期。出现问题时，应能通过代理检测、订单详情和工单记录定位原因。'],
  ['最终建议', '长期账号、店铺、社媒、广告验证等场景优先选静态住宅代理；采集、监控、批量访问等场景按任务节奏评估动态代理。真实购买以后台资源、价格和库存为准。'],
];

const faqUseCaseSections: TextCard[] = [
  ['社媒账号运营', '建议优先关注地区一致性、环境稳定性和会话保持能力。账号长期登录场景不应频繁切换地区和线路。'],
  ['跨境电商与店铺运营', '更适合选择稳定的静态住宅代理，并保持店铺地区、浏览器环境、支付环境和代理地区一致，降低关联和验证风险。'],
  ['网页采集与自动化', '应按目标站点、请求频率、失败率和地区要求选择代理类型。高频任务需要合理控制并发、重试和轮换策略。'],
  ['广告验证与投放检查', '重点看地区准确度、出口稳定性和目标平台返回结果。不同广告平台可能使用不同 IP 数据库，检测结果需要交叉核验。'],
  ['SEO 监控与本地化搜索', '需要按国家、城市、语言和设备环境保持一致。搜索结果受缓存、账号、浏览器和定位策略影响，不应只看单次结果。'],
  ['企业访问与工具集成', '应优先确认协议、认证方式、白名单、接口密钥、请求日志和权限范围，保证团队使用可审计、可回溯。'],
];

const dynamicStats: TextCard[] = [
  ['24小时+', '支持24小时灵活切换IP地址，适应不同网络场景，满足多样化业务需求。'],
  ['4700万+', '遍布190个国家的真实家庭住宅代理，合规获取。'],
  ['多种认证模式可选', '支持账号密码+白名单双接入等认证模式，灵活选择的同时更确保安全高效。'],
  ['业务级清洗', '不同业务场景出货IP均超过6个月冷静期，具备超高的纯净度。'],
  ['多种流量套餐可选', '提供多种流量套餐选择，灵活满足不同需求。'],
  ['易于集成', '通过开放接口可集成不同系统、简化开发流程、促进项目合作，实现数据交换与扩展。'],
];

const dynamicUseCases: TextCard[] = [
  ['海外直播', '满足TikTok/Shopee/Amazon等海外多平台直播网络需求，实现零卡顿、低延迟，告别掉线停播。'],
  ['短视频矩阵', '用专线网络和独享静态IP打造矩阵运营网络，避免限流封号，实现批量起号养号。'],
  ['企业加速', '助力企业实现跨域访问，应用加速以及全球组网建设，构建高速、稳定、安全的加速网络。'],
  ['智能工具', '适配海外智能工具访问、账号注册和业务操作，提高团队使用效率。'],
  ['电子商务', '跨境电商店铺运营、实时查询热销产品和监控竞争对手，找准优质商机。'],
  ['社交媒体营销', '使用静态住宅IP让海外社媒账户更稳定，利于多账户矩阵营销，助力业务增长。'],
  ['品牌营销', '实时监测品牌舆情信息和市场动向，快速响应并积极维护品牌形象与口碑。'],
  ['市场调查', '轻松采集产品的目标受众信息和竞品情报，制定更高效的营销策略。'],
];

const aboutValues: TextCard[] = [
  ['严格IP审核机制', '一手直接源头网络线路运营商，确保IP高纯净度，避免滥用导致封禁。'],
  ['1v1技术、售后支持', '快速响应客户需求，提供定制化解决方案。'],
  ['合规透明合作', '所有IP仅限合法用途，遵守全球数据隐私法规。'],
  ['强大技术支撑', '专业的网络、运维工程师，支撑全球网络、机房灵活调度架构。'],
];

const aboutAdvantages: TextCard[] = [
  ['100%真实住宅IP', 'IP来源于全球普通家庭网络，非机房或数据中心代理，有效规避风控检测。'],
  ['动态 & 静态IP可选', '支持自动轮换和长期固定两种模式，满足不同业务需求。'],
  ['高速稳定低延迟', '优化全球网络路由，确保访问速度和成功率，适合高并发任务。'],
  ['精准地理位置定位', '支持城市级IP定位，轻松模拟本地用户行为。'],
  ['灵活计费模式', '按流量、IP数量或订阅制付费，性价比高，无隐藏费用。'],
];

const partnerCategories = ['全部', '指纹浏览器', '智能工具', 'IP检测', '跨境工具', '导航网站', '数据工具', '云手机', '支付工具'] as const;

const partners: Array<{ category: string; title: string; description: string; href?: string }> = [
  { category: '指纹浏览器', title: 'AdsPower', description: '让出海多账号管理更安全、更高效。', href: 'https://www.adspower.net/' },
  { category: '智能工具', title: '六耳智能工具导航站', description: '汇集海内外优质智能工具和信息源。', href: 'https://ainavtool.com/' },
  { category: '跨境工具', title: 'Cloakerly', description: '功能强大的云端伪装平台，保护和优化广告活动。', href: 'http://cloakerly.com/' },
  { category: '跨境工具', title: 'TWT Chat 智能客服', description: '提供工单、群聊、多语言翻译和远程协助。', href: 'https://www.twt.com/' },
  { category: '导航网站', title: '萝卜智能工具箱', description: '官方推荐的实战、测评、学习、变现工具集合平台。', href: 'https://tools.aiydn.com' },
  { category: '跨境工具', title: '跨境财税服务', description: '欧代英代、欧洲EPR、全球VAT注册申报、海外公司注册。' },
  { category: '导航网站', title: 'VPS 小白', description: 'Linux学习、VPS分享、网络资源和实用技术。' },
  { category: '导航网站', title: '潮运营', description: '便捷运营人的专属流行大全工具箱。' },
  { category: '指纹浏览器', title: '比特浏览器', description: '支持高性能无限并发，适合账号管理和数据采集。' },
  { category: '数据工具', title: 'SpiderBox 虫盒', description: '爬虫逆向资源导航站。' },
  { category: '云手机', title: '云手机工具', description: '低价流畅不闪退，稳定多开同步操作。' },
  { category: '支付工具', title: '虚拟卡平台', description: '面向跨境支付业务的发卡和充值平台。' },
  { category: '指纹浏览器', title: 'MasLogin', description: '一台设备管理无限账号，防检测指纹与环境隔离。' },
  { category: '智能工具', title: '外贸智能体', description: '专为制造业出海打造的新一代智能外贸助手。' },
  { category: 'IP检测', title: 'IP检测', description: '检测您的IP质量、DNS泄露和网络环境。' },
  { category: '跨境工具', title: 'SocialEcho', description: '面向海外社媒的多账号管理平台。' },
  { category: '跨境工具', title: 'TikTok矩阵系统', description: '提供多种自动化解决方案，支持账号批量管理。' },
  { category: '导航网站', title: '跨境电商论坛', description: '跨境电商技术交流论坛和资源入口。' },
  { category: '指纹浏览器', title: '候鸟浏览器', description: '为多账号防关联而生的指纹浏览器。' },
  { category: '跨境工具', title: '跨境ERP', description: '免费的跨境电商ERP，助力卖家高效运营。' },
  { category: '数据工具', title: '穿云接口', description: '支持反爬虫验证、防护页面和浏览器指纹参数配置。' },
  { category: '导航网站', title: '跨境出海导航', description: '一站式跨境电商市场生态平台。' },
  { category: '数据工具', title: '达人精灵', description: '一站式助力TikTok内容电商，提供素材和达人洞察。' },
  { category: '指纹浏览器', title: 'NestBrowser', description: '创建多个独立且纯净的数字指纹环境。' },
];

const legalDocuments = {
  agreement: {
    title: '用户服务协议',
    summary: '本协议用于说明用户使用平台产品、账号、订单、代理资源、接口和分站能力时需要遵守的基本规则。',
    sections: [
      ['服务范围', '平台提供住宅代理资源展示、购买、订单履约、代理交付、接口接入、分站管理和相关技术支持。具体可购买资源、库存、价格和交付结果以登录后的真实后台数据为准。'],
      ['账号与安全', '用户应妥善保管账号、密码、接口密钥、白名单和代理凭据。因用户主动泄露、共享或未正确保管造成的风险，由用户自行承担。'],
      ['购买与交付', '用户提交订单前应确认国家、城市、线路、数量、周期和价格。订单创建、扣款、履约、失败退款均通过平台真实后端流程执行。'],
      ['合规使用', '用户不得将代理服务用于违反法律法规、侵犯第三方权益、攻击、欺诈、垃圾信息、恶意注册或其他不合规场景。平台有权对异常使用进行限制或终止服务。'],
      ['服务调整', '上游资源、库存、地区、价格和线路可能随供应情况变化。平台会尽力保持资源信息可见、可追踪，但不承诺任一地区或线路永久可用。'],
    ],
  },
  privacy: {
    title: '隐私协议',
    summary: '本协议说明平台在账号、购买、支付、代理交付、接口调用和分站管理过程中如何处理用户信息。',
    sections: [
      ['信息收集', '平台会在注册、登录、购买、充值、接口调用和工单处理过程中收集必要的账号信息、订单信息、请求记录、余额记录和操作日志。'],
      ['信息使用', '相关信息用于身份验证、资源报价、订单履约、余额变动、风险控制、客服支持、审计追踪和系统安全。'],
      ['信息保护', '平台会按业务需要限制数据访问范围，并通过权限控制、日志审计和必要的安全措施降低未授权访问风险。'],
      ['第三方服务', '涉及上游代理资源、支付、部署或基础设施服务时，平台可能按最小必要原则与对应服务交互。用户的真实购买和履约信息以系统记录为准。'],
      ['用户权利', '用户可通过账号中心、工单或客服渠道查询、更新或申请处理与自身账号相关的信息。'],
    ],
  },
  refund: {
    title: '退款协议',
    summary: '本协议用于说明充值、购买、履约失败和售后退款的处理原则。',
    sections: [
      ['充值说明', '用户充值后余额进入账户，可用于购买平台上架的代理资源。充值记录、余额变动和人工调整均应在后台保留可审计记录。'],
      ['订单失败', '如订单扣款后履约失败，系统应按真实履约结果触发失败处理和退款流程，避免出现扣款成功但未交付且无记录的状态。'],
      ['资源确认', '代理资源一经成功交付，用户应及时在订单和代理列表中核对国家、城市、线路、账号密码、端口和有效期。'],
      ['不支持情形', '因用户自身环境、错误配置、违规使用、凭据泄露或已成功交付后超出售后范围的请求，可能无法按未交付订单处理。'],
      ['售后处理', '用户可提交工单说明订单编号、资源信息和问题现象。平台会根据订单、履约、代理检测和操作记录进行核验。'],
    ],
  },
} as const;

export function PublicTutorialsPage() {
  const directoryItems = [
    ...tutorialCategoryGroups.map((category) => ({ category, kind: 'tutorial' as const, label: '教程' })),
    ...newsCategories.map((category) => ({ category, kind: 'news' as const, label: '资讯' })),
  ];

  return (
    <OfficialShell active="教程">
      <main className="official-main official-tutorial-main">
        <section className="official-tutorial-section">
          <header className="official-tutorial-header">
            <h1>教程</h1>
            <p>浏览代理配置指南、客户端接入教程、指纹浏览器设置、故障排查和性能优化实践，覆盖静态住宅代理、动态住宅代理、HTTP/SOCKS5 协议和跨境业务使用场景。</p>
          </header>
          <label className="official-search official-tutorial-search">
            <input type="search" aria-label="搜索教程" placeholder="请输入您的问题..." />
            <span>搜</span>
          </label>

          <div className="official-tutorial-grid" aria-label="教程与资讯分类">
            {directoryItems.map(({ category, kind, label }) => (
              <article className="official-tutorial-card" key={`${kind}-${category.slug}`}>
                <span className="official-tutorial-label">{label}</span>
                <h2>{category.title}</h2>
                <ul>
                  {category.articles.slice(0, 5).map((article) => (
                    <li key={`${category.title}-${article.slug}`}>
                      <a href={articleHref(kind, article.slug)}>{article.title}</a>
                    </li>
                  ))}
                </ul>
                <a className="official-tutorial-more" href={categoryHref(kind, category.slug)}>
                  查看更多
                  <span aria-hidden="true">→</span>
                </a>
              </article>
            ))}
          </div>
        </section>
      </main>
    </OfficialShell>
  );
}

export function PublicPricingPage() {
  return <PublicBuyPage />;
}

export function PublicDynamicProductPage() {
  return (
    <OfficialShell active="动态住宅">
      <main className="official-main">
        <section className="official-hero official-dynamic-hero">
          <div>
            <span className="official-eyebrow">代理产品</span>
            <h1>动态住宅IP代理</h1>
            <p>全球真实住宅IP，支持灵活切换和多种认证方式，适用于规模化采集、账号运营、海外直播、自动化脚本和地区访问验证。</p>
            <div className="official-check-list">
              <span>注意：海外代理IP仅在境外网络环境下才可正常使用</span>
            </div>
            <div className="official-hero-actions">
              <a className="official-button official-button-lg" href="/login">立即获取</a>
              <a className="official-ghost-button" href="/tutorials">查看教程</a>
            </div>
          </div>
          <div className="official-hero-visual">
            <img src="/images/ipipd/house-logo.avif" alt="动态住宅代理覆盖网络" />
          </div>
        </section>

        <section>
          <div className="official-section-title">
            <h2>关于 ipmigo 动态住宅代理</h2>
          </div>
          <div className="official-number-grid">
            {dynamicStats.map(([title, description], index) => (
              <article className="official-number-card" key={title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <h2>{title}</h2>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="official-section-title">
            <h2>满足多种业务需求</h2>
          </div>
          <div className="official-usecase-grid">
            {dynamicUseCases.map(([title, description]) => (
              <article className="official-usecase-card" key={title}>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="official-text-section official-dynamic-faq">
          <h2>动态住宅常见问题</h2>
          <div className="official-question-list">
            {[
              '能够提供哪些地理位置的IP？',
              '你们的IP代理和我的业务匹配么？',
              '你们的动态住宅IP速度和性能如何？',
              '你们支持免费测试吗？',
              '动态流量包的有效期是怎么回事？',
              '动态IP的时效是什么意思？',
              '动态IP连接端口的IP怎么切换？',
              '免费赠送流量用完后，会自动扣费吗？',
              '能提供哪些技术支持？',
              '线路显示流量不足怎么办？',
            ].map((question) => <span key={question}>{question}</span>)}
          </div>
        </section>
      </main>
    </OfficialShell>
  );
}

export function PublicAboutPage() {
  return (
    <OfficialShell active="关于我们">
      <main className="official-main">
        <section className="official-about-hero">
          <div>
            <h1>关于 ipmigo</h1>
            <p>优选跨境网络服务商，助力畅享全球连接</p>
            <a className="official-button official-button-lg" href="/buy">立即获取</a>
          </div>
        </section>

        <section className="official-about-intro">
          <div>
            <h2>品牌介绍</h2>
            <p>introduction</p>
          </div>
          <div className="official-about-intro-grid">
            <img src="/images/ipipd/world.avif" alt="全球网络" />
            <p>
              ipmigo 是面向跨境业务团队的住宅代理服务平台，专注于真实资源同步、清晰定价、订单交付和售后追踪。我们以合规使用为前提，帮助团队按国家、地区和业务场景选择合适的代理资源。
              <br />
              <br />
              在账号运营、广告验证、跨境电商和数据采集等场景中，稳定可信的网络环境会直接影响业务效率。ipmigo 通过后台资源配置、实时价格和可追踪订单，降低团队选择和管理代理资源的成本。
              <br />
              <br />
              我们会持续完善资源覆盖、购买流程、代理检测和工单支持，让每一次购买、交付和排障都有据可查。
            </p>
          </div>
        </section>

        <section>
          <div className="official-section-title">
            <h2>为什么选择我们？</h2>
            <p>专业、安全、全球化的住宅IP服务</p>
          </div>
          <div className="official-about-why-grid">
            {aboutValues.map(([title, description]) => (
              <article className="official-about-why-card" key={title}>
                <h2>{title}</h2>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="official-section-title">
            <h2>核心优势</h2>
            <p>专业可靠的IP代理服务，助力您的业务无界拓展</p>
          </div>
          <div className="official-advantage-grid">
            {aboutAdvantages.map(([title, description]) => (
              <article className="official-advantage-card" key={title}>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </OfficialShell>
  );
}

export function PublicPartnersPage() {
  const [activeCategory, setActiveCategory] = useState<(typeof partnerCategories)[number]>('全部');
  const visiblePartners = activeCategory === '全部'
    ? partners
    : partners.filter((partner) => partner.category === activeCategory);

  return (
    <OfficialShell active="合作伙伴">
      <main className="official-main official-partners-main">
        <section className="official-partners-hero">
          <div>
            <h1>成为 ipmigo 合作伙伴</h1>
            <p>汇聚指纹浏览器、智能工具、IP检测、跨境工具、导航网站、数据工具、云手机和支付工具等生态伙伴，共同服务跨境电商、社媒运营、广告验证和数据采集客户。</p>
          </div>
          <a className="official-button official-button-lg" href="/promotion">了解推广返佣</a>
        </section>

        <section className="official-partner-tabs" aria-label="合作伙伴分类">
          {partnerCategories.map((category) => (
            <button
              className={category === activeCategory ? 'active' : undefined}
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </section>

        <section className="official-partner-grid" aria-label="合作伙伴列表">
          {visiblePartners.map(({ category, title, description, href }) => (
            href ? (
              <a className="official-partner-card" href={href} key={title} rel="nofollow noopener noreferrer" target="_blank">
                <PartnerCardContent category={category} description={description} title={title} />
              </a>
            ) : (
              <article className="official-partner-card" key={title}>
                <PartnerCardContent category={category} description={description} title={title} />
              </article>
            )
          ))}
        </section>
      </main>
    </OfficialShell>
  );
}

function PartnerCardContent({ category, description, title }: { category: string; description: string; title: string }) {
  return (
    <>
      <span className="official-partner-logo">{title.slice(0, 1)}</span>
      <span className="official-partner-divider" />
      <p>{description}</p>
      <strong>{title}</strong>
      <em>{category}</em>
    </>
  );
}

export function PublicNewsPage() {
  const featuredArticles = newsArticles.slice(0, 3);
  const listArticles = newsArticles.slice(3, 15);
  const categorySlugByTitle = new Map(newsCategories.map((category) => [category.title, category.slug]));

  return (
    <OfficialShell active="教程">
      <main className="official-main official-news-main">
        <section className="official-news-hero">
          <div>
            <h1>新闻资讯</h1>
            <p>获取最新的行业动态、产品更新和代理使用经验，帮助你评估代理方案、优化资源使用，并持续跟踪跨境网络场景变化。</p>
          </div>
        </section>

        <section className="official-category-strip" aria-label="资讯分类">
          {newsCategories.map((category) => (
            <a href={categoryHref('news', category.slug)} key={category.slug}>{category.title}</a>
          ))}
        </section>

        <section className="official-news-ad-grid" aria-label="精选资讯">
          {featuredArticles.map((article, index) => (
            <a className={`official-news-ad-card official-news-ad-card-${index + 1}`} href={articleHref('news', article.slug)} key={article.slug}>
              <span>{article.category}</span>
              <h2>{article.title}</h2>
              <p>{article.description}</p>
            </a>
          ))}
        </section>

        <section className="official-news-list" aria-label="资讯列表">
          {listArticles.map((article) => (
            <article className="official-news-row" key={article.slug}>
              <a className="official-news-thumb" href={articleHref('news', article.slug)} aria-label={article.title}>
                <span>{article.category.slice(0, 2)}</span>
              </a>
              <div>
                <h2>
                  <a href={articleHref('news', article.slug)}>{article.title}</a>
                </h2>
                <p>{article.description}</p>
                <div>
                  <a href={categoryHref('news', categorySlugByTitle.get(article.category) ?? 'kep')}>{article.category}</a>
                  <time dateTime={article.updatedAt}>{article.updatedAt}</time>
                </div>
              </div>
            </article>
          ))}
        </section>
      </main>
    </OfficialShell>
  );
}

export function PublicUserAgreementPage() {
  return <LegalPage document={legalDocuments.agreement} />;
}

export function PublicPrivacyPolicyPage() {
  return <LegalPage document={legalDocuments.privacy} />;
}

export function PublicRefundPolicyPage() {
  return <LegalPage document={legalDocuments.refund} />;
}

export function PublicPromotionPage() {
  return (
    <OfficialShell active="推广返佣">
      <main className="official-main">
        <section className="official-hero official-promotion-hero">
          <div>
            <h1>
              成为 ipmigo 合作伙伴
              <br />
              赚取最高10%返佣
            </h1>
            <p>跨境业务必备的代理IP，能全面激活您的盈利潜力，让营收再上新台阶。</p>
            <p><a className="official-button official-button-lg" href="/login">开启返佣</a></p>
          </div>
          <div className="official-hero-visual">
            <img src="/images/ipipd/tuiguang-rebate.png" alt="合作伙伴推广背景" />
          </div>
        </section>

        <section className="official-feature-grid" aria-label="合作优势">
          {promotionFeatures.map(([title, desc, icon]) => (
            <article className="official-card" key={title}>
              {icon ? <img src={icon} alt="" aria-hidden="true" /> : null}
              <h2>{title}</h2>
              <p>{desc}</p>
            </article>
          ))}
        </section>

        <section>
          <div className="official-section-title">
            <h2>4 种合作模式，总有一款适合你</h2>
          </div>
          <div className="official-mode-grid">
            {promotionModes.map((mode) => (
              <article className="official-mode" key={mode.title}>
                <div className="official-mode-head">
                  <img src={mode.icon} alt="" aria-hidden="true" />
                  <h3>{mode.title}</h3>
                </div>
                <ul>
                  {mode.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <a className="official-button" href="/login">{mode.action}</a>
              </article>
            ))}
          </div>
        </section>
      </main>
    </OfficialShell>
  );
}

export function PublicFaqPage() {
  return (
    <OfficialShell active="帮助中心">
      <main className="official-main official-faq-main">
        <section className="official-faq-section">
          <div className="official-faq-hero">
            <span className="official-eyebrow">帮助中心</span>
            <h1>从教程开始解决代理使用问题</h1>
            <p>按购买、配置、认证、排查和业务场景整理常见问题。优先进入对应教程，遇到账号或订单问题再登录提交工单。</p>
            <label className="official-search official-faq-search">
              <span>搜</span>
              <input type="search" aria-label="搜索帮助内容" placeholder="搜索 Socks5、白名单、连接失败、动态地址、AdsPower..." />
            </label>
          </div>

          <div className="official-help-layout">
            <aside className="official-help-sidebar" aria-label="帮助目录">
              <strong>目录</strong>
              {faqGuideSections.map((section) => (
                <a href={`#${section.id}`} key={section.id}>
                  <span>{section.title}</span>
                  <em>{section.items.length}</em>
                </a>
              ))}
              <a href="/tutorials/category/qt">
                <span>常见问题教程</span>
                <em>FAQ</em>
              </a>
            </aside>

            <div className="official-help-content">
              {faqGuideSections.map((section) => (
                <section className="official-help-section" id={section.id} key={section.id}>
                  <header>
                    <h2>{section.title}</h2>
                    <p>{section.description}</p>
                  </header>
                  <div className="official-help-list">
                    {section.items.map(([title, desc, , href]) => (
                      <a className="official-help-row" href={href ?? '/tutorials'} key={title}>
                        <span>
                          <strong>{title}</strong>
                          <p>{desc}</p>
                        </span>
                        <em>查看</em>
                      </a>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </section>
      </main>
    </OfficialShell>
  );
}

export function PublicFaqProxySelectionPage() {
  return <FaqTopicPage slug="proxy-selection" />;
}

export function PublicFaqUseCasesPage() {
  return <FaqTopicPage slug="use-cases" />;
}

function FaqTopicPage({ slug }: { slug: string }) {
  const topic = findFaqTopic(slug);
  const sections = slug === 'use-cases' ? faqUseCaseSections : faqProxySelectionSections;

  return (
    <OfficialShell active="帮助中心">
      <main className="official-main">
        <section className="official-hero official-hero-centered official-faq-topic-hero">
          <div>
            <span className="official-eyebrow">{topic?.category ?? '帮助中心'}</span>
            <h1>{topic?.title ?? '代理 IP 常见问题'}</h1>
            <p>{topic?.description ?? '整理代理 IP 使用、选择、配置和排查中的高频问题。'}</p>
          </div>
        </section>

        <section className="official-faq-topic-grid" aria-label={topic?.summary ?? 'FAQ'}>
          {sections.map(([title, content]) => (
            <article className="official-faq-topic-card" key={title}>
              <h2>{title}</h2>
              <p>{content}</p>
            </article>
          ))}
        </section>

        <section className="official-text-section official-faq-next">
          <h2>继续查看教程</h2>
          <p>如果已经明确产品类型，可以进入教程中心查看浏览器、客户端、白名单、账号密码和代理检测的配置说明。</p>
          <a className="official-button" href="/tutorials">进入教程中心</a>
        </section>
      </main>
    </OfficialShell>
  );
}

function LegalPage({ document }: { document: (typeof legalDocuments)[keyof typeof legalDocuments] }) {
  return (
    <OfficialShell active="帮助中心">
      <main className="official-main">
        <section className="official-hero official-hero-centered official-legal-hero">
          <div>
            <span className="official-eyebrow">协议条款</span>
            <h1>{document.title}</h1>
            <p>{document.summary}</p>
          </div>
        </section>

        <article className="official-legal-card">
          {document.sections.map(([title, content]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{content}</p>
            </section>
          ))}
        </article>
      </main>
    </OfficialShell>
  );
}

function OfficialShell({ active, children }: { active: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = [
    ['首页', '/'],
    ['购买', '/pricing'],
    ['动态住宅', '/products/dynamic'],
    ['教程', '/tutorials'],
    ['推广返佣', '/promotion'],
    ['帮助中心', '/faq'],
  ];

  return (
    <div className="ipipd-official">
      <header className="official-header">
        <div className="official-header-inner">
          <a className="official-logo" href="/" aria-label="ipmigo 首页">
            <img src="/images/ipipd/logo.svg" alt="ipmigo" />
          </a>
          <nav className="official-nav" aria-label="主导航">
            {nav.map(([label, href]) => (
              <a className={label === active ? 'active' : undefined} href={href} key={label}>{label}</a>
            ))}
          </nav>
          <div className="official-actions">
            <a className="official-link" href="/login">登录</a>
            <a className="official-button" href="/register">注册</a>
          </div>
          <button
            className="official-menu-button"
            type="button"
            aria-label="菜单"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        {menuOpen ? (
          <div className="official-mobile-panel">
            <nav aria-label="移动端主导航">
              {nav.map(([label, href]) => (
                <a className={label === active ? 'active' : undefined} href={href} key={label}>{label}</a>
              ))}
            </nav>
            <div>
              <a href="/login">登录</a>
              <a href="/register">注册</a>
            </div>
          </div>
        ) : null}
      </header>
      {children}
      <footer className="official-footer">
        <section className="official-footer-cta">
          <h2>
            <span>立即开启</span>
            <strong>代理服务</strong>
          </h2>
          <p>全球住宅代理资源 · 静态与动态场景覆盖 · 登录后查看真实资源与价格</p>
          <a className="official-ghost-button" href="/login">联系我们</a>
        </section>
        <div className="official-footer-inner">
          <section>
            <h2>关于我们</h2>
            <p>ipmigo 提供住宅代理资源、购买、交付、检测、工单和分站能力，服务跨境业务、账号运营、广告验证和采集自动化场景。</p>
          </section>
          <section>
            <h2>代理产品</h2>
            <a href="/pricing">静态住宅代理</a>
            <a href="/products/dynamic">动态住宅代理</a>
            <a href="/faq">代理 IP FAQ</a>
          </section>
          <section>
            <h2>合作支持</h2>
            <a href="/promotion">推广返佣</a>
            <a href="/tutorials">使用教程</a>
            <a href="/faq">帮助中心</a>
          </section>
          <section>
            <h2>法律声明</h2>
            <a href="/user-agreement">用户服务协议</a>
            <a href="/privacy-policy">用户隐私协议</a>
            <a href="/refund-policy">退款协议</a>
          </section>
        </div>
        <div className="official-footer-bottom">
          <span>© 2026 ipmigo. 保留所有权利。</span>
          <span>代理产品仅限合法合规业务场景使用。</span>
        </div>
      </footer>
    </div>
  );
}
