export type PublicContentKind = 'news' | 'tutorial';

export interface PublicArticle {
  slug: string;
  title: string;
  description: string;
  category: string;
  updatedAt: string;
}

export interface PublicCategory {
  slug: string;
  title: string;
  description: string;
  articles: PublicArticle[];
}

export type PublicArticleBlock =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'image'; src: string; alt: string; title?: string }
  | { type: 'divider' };

export const newsArticles: PublicArticle[] = [
  {
    slug: 'what-is-static-residential-proxy',
    title: '什么是静态住宅代理 IP？定义、工作原理与适用场景',
    description: '讲清静态住宅代理 IP 的定义、工作原理、长期稳定业务场景和选择重点。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'static-residential-proxy-guide',
    title: '静态住宅代理是什么？适合哪些长期稳定业务',
    description: '解释静态住宅代理的使用方式，以及企业什么时候应该选择静态住宅 IP。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'dynamic-residential-proxy-guide',
    title: '动态住宅代理是什么？工作原理、适用场景和选择建议',
    description: '介绍动态住宅代理的轮换逻辑、适用场景和与静态住宅代理的差异。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'static-vs-dynamic-residential-proxy',
    title: '静态住宅代理和动态住宅代理有什么区别？怎么选更合适',
    description: '从稳定身份、IP 轮换、会话保持、SEO 监控和账号业务角度对比两类代理。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'residential-proxy-buying-mistakes',
    title: '购买住宅代理常见误区：低价为什么可能更贵',
    description: '梳理只看低价、只看 IP 数量、测试不足和产品类型不匹配等常见问题。',
    category: '购买指南',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'residential-proxy-price-guide',
    title: '住宅代理价格怎么看？影响成本的因素和套餐选择建议',
    description: '从代理类型、地区覆盖、会话稳定、成功率和隐藏成本角度理解住宅代理价格。',
    category: '购买指南',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'choose-residential-proxy-provider',
    title: '企业如何选择住宅代理服务商？关键指标和避坑建议',
    description: '按业务匹配、IP 质量、地区覆盖、文档、售后、小规模测试和价格做判断。',
    category: '购买指南',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'cheap-vs-reliable-residential-proxies',
    title: '便宜住宅代理和稳定住宅代理怎么选？别只看价格',
    description: '对比低价与稳定性的取舍，重点看任务风险、地区准确、成功率和恢复成本。',
    category: '购买指南',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'proxy-server-for-web-scraping',
    title: '什么是爬虫代理服务器-没人告诉你的真相',
    description: '介绍爬虫代理服务器的工作原理、选择标准、配置重点和常见误区。',
    category: '采集与自动化',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'web-scraping-proxy-best-practices',
    title: '代理服务器最佳实践：成功率95%和50%的差距在哪里',
    description: '围绕网页采集代理的稳定性、轮换策略、请求节奏和失败处理展开。',
    category: '采集与自动化',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'web-scraping-proxy-guide',
    title: 'Web抓取代理完整指南（2026最新）',
    description: '梳理 Web 抓取代理方案、地区选择、代理类型和风险边界。',
    category: '采集与自动化',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'web-scraping-proxy-tutorial',
    title: '爬虫代理实战：5分钟搭建高效数据采集系统',
    description: '用实战视角说明代理配置、请求节奏、失败重试和数据采集稳定性。',
    category: '采集与自动化',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'what-is-isp-proxy-server',
    title: '什么是ISP代理服务器？一篇给新手看的静态住宅代理指南',
    description: '解释 ISP 代理服务器的概念、适用业务和与住宅代理、数据中心代理的区别。',
    category: 'ISP 代理',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'isp-proxy-server-practical-guide',
    title: 'ISP代理服务器怎么用？从购买选择到配置测试的实战指南',
    description: '介绍 ISP 代理服务器的适用场景、配置思路、连接测试和避坑建议。',
    category: 'ISP 代理',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'isp-proxy-server-vs-residential-vs-datacenter',
    title: 'ISP代理服务器、住宅代理和数据中心代理怎么选？',
    description: '对比 ISP、住宅代理和数据中心代理在业务适配、稳定性和成本上的差异。',
    category: 'ISP 代理',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'mobile-proxy',
    title: '移动代理用于社交媒体：完整的多账号运营策略',
    description: '围绕移动代理、社媒账号运营、设备环境和多账号隔离说明适配思路。',
    category: '社媒与账号',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'tiktok-static-vs-dynamic-ip',
    title: 'TikTok新手避坑指南：原生住宅IP vs 静态住宅IP，到底该怎么选？',
    description: '面向 TikTok 账号环境，说明原生住宅 IP 与静态住宅 IP 的选型逻辑。',
    category: '社媒与账号',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'amazon-seller-static-residential-ip',
    title: '亚马逊卖家必看：如何用静态住宅IP稳定店铺流量，防止关联封号？',
    description: '面向亚马逊卖家，梳理静态住宅 IP 在账号稳定和关联风险控制中的作用。',
    category: '电商与风控',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'ntt123',
    title: '美国原生IP资源公示：NTT America (AS2914) 核心段解析',
    description: '围绕美国原生 IP、ISP 代理、美国静态独享 IP 和企业级业务场景说明资源特点。',
    category: '资源公示',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'ijj',
    title: '日系原生IP天花板：IIJ 大段资源现货',
    description: '介绍日本 IIJ 原生 IP 资源、适用业务和使用前需要关注的风险边界。',
    category: '资源公示',
    updatedAt: '2026-06-15',
  },
  {
    slug: '香港1',
    title: '2026顶级原生IP资源公示：日本IIJ与香港 Cable TV 核心段解析',
    description: '围绕日本与香港原生 ISP 资源说明业务适配、配置思路和选择建议。',
    category: '资源公示',
    updatedAt: '2026-06-15',
  },
  {
    slug: '香港2',
    title: '香港原生 ISP 住宅 IP 资源：HKBN/有线电视核心段正式上线',
    description: '说明香港原生 ISP 住宅 IP 资源特点、适用业务和使用前检查项。',
    category: '资源公示',
    updatedAt: '2026-06-15',
  },
  {
    slug: '英国gtt',
    title: '英国原生IP资源报告：GTT 核心段公示',
    description: '围绕英国原生 IP 资源、GTT 线路和海外业务本土化场景说明资源特点。',
    category: '资源公示',
    updatedAt: '2026-06-15',
  },
  {
    slug: '1',
    title: '原生住宅IP vs 静态住宅IP：跨境电商网络环境选型指南',
    description: '本文围绕原生住宅IPvs静态住宅IP：跨境电商网络环境选型指南展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: '15615332',
    title: '《Facebook BM被封又被限？虚拟卡多账户隔离+IP隔离双保险破解困局》',
    description: '本文围绕《FacebookBM被封又被限？虚拟卡多账户隔离+IP隔离双保险破解困局》展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '社媒与账号',
    updatedAt: '2026-06-15',
  },
  {
    slug: '1654321',
    title: '住宅IP、家宽IP与原生IP：核心概念辨析与选型指南',
    description: '本文围绕住宅IP、家宽IP与原生IP：核心概念辨析与选型指南展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: '2',
    title: '跨境业务为什么必须用住宅IP？多账号运营避坑指南',
    description: '本文围绕跨境业务为什么必须用住宅IP？多账号运营避坑指南展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: '234',
    title: '移动代理 vs 数据中心代理：到底哪个更好用',
    description: '本文围绕移动代理vs数据中心代理：到底哪个更好用展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'adsss',
    title: '海外社媒运营太混乱？这款工具帮你做多账号智能管理和增长',
    description: '本文围绕海外社媒运营太混乱？这款工具帮你做多账号智能管理和增长展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '社媒与账号',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'cross-border-payment-risk-ip',
    title: '跨境支付风控 解密：为什么你的PayPal/Stripe账户总被冻结？IP可能是元凶',
    description: '本文围绕跨境支付风控解密：为什么你的PayPal/Stripe账户总被冻结？IP可能是元凶展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '社媒与账号',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'daili',
    title: '选错代理等于白花钱：住宅代理vs移动代理深度对比',
    description: '本文围绕选错代理等于白花钱：住宅代理vs移动代理深度对比展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'dailizhinan',
    title: '数据中心代理完整指南：为什么老手宁愿多花钱也不用',
    description: '本文围绕数据中心代理完整指南：为什么老手宁愿多花钱也不用展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'Data-Center-Proxy',
    title: '这3种情况用了数据中心代理，账号必死',
    description: '本文围绕这3种情况用了数据中心代理，账号必死展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'dldqb',
    title: '什么时候用ISP代理-什么时候用住宅代理',
    description: '本文围绕什么时候用ISP代理-什么时候用住宅代理展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'dlqb',
    title: 'ISP代理和住宅代理有什么区别？选哪个？',
    description: '本文围绕ISP代理和住宅代理有什么区别？选哪个？展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'dtujnh',
    title: '一眼看懂！静态IP vs 动态IP：给你的网络身份选个“常住地址”还是“临时酒店”？',
    description: '本文围绕一眼看懂！静态IPvs动态IP：给你的网络身份选个“常住地址”还是“临时酒店”？展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '购买指南',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'dynamic-residential-proxy-mistakes',
    title: '动态住宅代理常见问题：请求失败、会话中断和 IP 异常怎么排查',
    description: '本文总结动态住宅代理常见问题，包括过度轮换、请求节奏过快、地区不匹配、重试逻辑薄弱、缺少日志和静态/动态 IP 选择错误。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'dynamic-residential-proxy-use-cases',
    title: '动态住宅代理怎么用于数据采集和 SEO 监控',
    description: '本文讲解动态住宅代理在数据采集、SEO 排名追踪、SERP 检查和监控流程中的实际配置思路，包括地区、会话、轮换、请求节奏和失败处理。',
    category: '采集与自动化',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'isp',
    title: '什么是ISP代理？为什么越来越多人用它取代数据中心代理',
    description: '本文围绕什么是ISP代理？为什么越来越多人用它取代数据中心代理展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'Mobile-Proxy-Complete-Guide',
    title: '移动代理完整指南（2026）：购买前必知的全部内容',
    description: '本文围绕移动代理完整指南（2026）：购买前必知的全部内容展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'residential-proxy-buy-scenarios',
    title: '住宅代理购买方案：SEO、广告验证、电商监控和数据采集分别怎么买',
    description: '本文从 SEO 监控、广告验证、电商价格监控、公开数据采集和账号环境五类场景出发，讲清楚住宅代理购买时应该如何选择地区、代理类型、套餐和测试指标，避免用同一套方案处理所有业务。',
    category: '采集与自动化',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'residential-proxy-service-guide',
    title: '住宅代理服务怎么选？企业购买前需要了解什么',
    description: '从业务匹配、静态和动态住宅 IP、IP 质量、会话、售后和成本角度，梳理企业如何选择住宅代理服务。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'residential-proxy-service-mistakes',
    title: '住宅代理服务常见坑：价格、IP 质量和售后风险',
    description: '梳理住宅代理服务常见坑，包括流程不清、只看价格、测试薄弱、指标错误、售后风险和内容过度包装。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'Residential-Proxy',
    title: 'Residential Proxy行业不会告诉你的6件事',
    description: '本文围绕ResidentialProxy行业不会告诉你的6件事展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '购买指南',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'Residential-Proxy2',
    title: '住宅代理不是万能的：什么时候用它最合适',
    description: '本文围绕住宅代理不是万能的：什么时候用它最合适展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'static-dynamic-residential-proxy-mistakes',
    title: '静态和动态住宅代理选错会怎样？常见业务误配场景',
    description: '梳理静态和动态住宅代理选错类型时常见的问题，包括过度轮换、轮换不足、地区错配和指标错误。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'static-dynamic-residential-proxy-use-cases',
    title: '爬虫、SEO 和账号业务分别适合静态还是动态住宅代理',
    description: '按爬虫、SEO 监控、账号管理和混合团队场景，判断静态住宅代理和动态住宅代理怎么分配。',
    category: '采集与自动化',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'static-residential-proxy-account-management',
    title: '静态住宅代理适合哪些账号管理和长期登录场景',
    description: '本文讲解静态住宅代理在账号管理、长期登录、浏览器资料、客户后台和稳定业务流程中的使用方法与配置注意事项。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'static-residential-proxy-mistakes',
    title: '静态住宅代理常见误区：登录风控、IP 信任度和会话稳定性',
    description: '本文总结静态住宅代理常见误区，包括频繁换 IP、地区不匹配、浏览器资料不一致、认证配置错误和静态/动态产品选错。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'web-scraping-proxy-comparison',
    title: '2026年最全Web抓取代理解决方案对比',
    description: '本文围绕2026年最全Web抓取代理解决方案对比展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '采集与自动化',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'web-scraping-proxy-setup',
    title: '构建一个永不被封的爬虫系统：大多数教程都跳过的关键步骤',
    description: '本文介绍爬虫代理配置、请求节奏和住宅代理使用方法，帮助你理解代理使用场景、配置重点和常见风险，并减少连接失败和账号异常。',
    category: '采集与自动化',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'zhbf',
    title: '做TikTok/Instagram的注意：数据中心代理是你账号被封的元凶',
    description: '本文围绕做TikTok/Instagram的注意：数据中心代理是你账号被封的元凶展开，讲清适用场景、配置思路、风险边界和ipmigo住宅代理选择建议。',
    category: '代理 IP 资讯',
    updatedAt: '2026-06-15',
  },
];

export const tutorialArticles: PublicArticle[] = [
  {
    slug: 'zhuce',
    title: '注册登录指南',
    description: '说明账号注册、登录、找回访问入口和购买前需要准备的信息。',
    category: '入门指引',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'chanpin',
    title: '产品介绍',
    description: '说明静态住宅代理、动态住宅代理、资源地区、协议和交付方式。',
    category: '入门指引',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'fukuan',
    title: '付款方式与计费规则',
    description: '介绍充值、余额、订单扣款、履约失败退款和后台记录核对方式。',
    category: '入门指引',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'zhinan',
    title: 'ipmigo代理连接失败排查指南',
    description: '从协议、白名单、账号密码、端口、网络环境和代理检测排查连接失败。',
    category: '入门指引',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'tuiguang',
    title: '推广计划说明',
    description: '说明推广计划、订单归属、返佣记录、分站合作和后台核对规则。',
    category: '入门指引',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'fp',
    title: '是否支持开具发票',
    description: '说明发票申请、订单记录、充值记录和售后核验所需的信息。',
    category: '常见问题',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'dailizhilian',
    title: '代理IP是否支持直连？如何使用？',
    description: '说明直连、链式代理、协议选择和客户端配置中的注意事项。',
    category: '常见问题',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'liuliangxianzhi',
    title: 'IP带宽是多少？是否有流量限制？',
    description: '说明带宽、连接质量、使用环境、上游资源和业务稳定性的关系。',
    category: '常见问题',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'jiance',
    title: '如何检测网络是否处于海外环境？',
    description: '说明代理检测、归属地查询、DNS、浏览器环境和平台结果不一致的处理方式。',
    category: '常见问题',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'guishudi',
    title: '为什么不同平台查询到的IP归属地不一致',
    description: '解释不同 IP 数据库、缓存更新、线路展示和上游标记差异造成的归属地差异。',
    category: '常见问题',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'paicha',
    title: '代理使用网速慢排查指南',
    description: '从本地网络、协议、节点地区、目标站点、并发和代理资源状态排查速度问题。',
    category: '常见问题',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'jc',
    title: '注册购买教程',
    description: '按登录、选择国家城市、生成报价、下单、等待履约和查看代理的流程购买。',
    category: '客户端教程',
    updatedAt: '2026-06-15',
  },
  {
    slug: '71256',
    title: 'V2rayN配置静态住宅代理—链式代理',
    description: '说明在 V2rayN 中配置静态住宅代理、链式代理和连接测试的基本流程。',
    category: '客户端教程',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'V2ray',
    title: 'V2ray设置使用代理IP的教程',
    description: '说明 V2ray 中代理协议、地址、端口、认证信息和路由规则的配置方式。',
    category: '客户端教程',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'ios',
    title: 'iOS端使用教程',
    description: '介绍 iOS 设备配置代理、检查连接和确认业务环境的基本步骤。',
    category: '客户端教程',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'Android',
    title: '安卓端使用教程',
    description: '介绍安卓设备配置代理、检查协议和排查连接失败的基本步骤。',
    category: '客户端教程',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'Adspower',
    title: 'AdsPower浏览器使用教程',
    description: '说明 AdsPower 指纹浏览器中配置 ipmigo 代理和检查账号环境的方法。',
    category: '浏览器操作教程',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'zn',
    title: '紫鸟指纹浏览器',
    description: '说明紫鸟指纹浏览器中配置代理、绑定环境和检测访问结果的流程。',
    category: '浏览器操作教程',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'hn',
    title: '候鸟浏览器使用教程',
    description: '说明候鸟浏览器中代理地址、账号密码、协议和地区检测的配置方法。',
    category: '浏览器操作教程',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'bt',
    title: '比特指纹浏览器使用教程',
    description: '说明比特指纹浏览器中配置代理、保存环境和测试连通性的流程。',
    category: '浏览器操作教程',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'MoreLogin',
    title: 'MoreLogin指纹浏览器使用方式',
    description: '说明 MoreLogin 指纹浏览器配置 ipmigo 代理的步骤和注意事项。',
    category: '浏览器操作教程',
    updatedAt: '2026-06-15',
  },
  {
    slug: 'HubStudio',
    title: 'HubStudio指纹浏览器使用教程',
    description: '说明 HubStudio 指纹浏览器配置代理、保存环境和排查异常的方法。',
    category: '浏览器操作教程',
    updatedAt: '2026-06-15',
  },
  {
    slug: '596111',
    title: '腾讯云服务器购买示意图',
    description: '说明云服务器购买、网络环境准备和代理接入前的基础检查。',
    category: '腾讯云服务器',
    updatedAt: '2026-06-15',
  },
  {
    slug: '1581321658',
    title: '腾讯云轻量应用服务器示意图',
    description: '说明轻量应用服务器准备、网络设置和代理接入检查流程。',
    category: '腾讯云服务器',
    updatedAt: '2026-06-15',
  },
];

export const tutorialCategoryGroups: PublicCategory[] = [
  buildCategory('入门指引', '入门指引', '注册登录、产品介绍、付款方式、连接排查和推广计划。', tutorialArticles),
  buildCategory('常见问题', 'qt', '发票、直连、带宽、归属地、检测和速度排查。', tutorialArticles),
  buildCategory('客户端教程', 'kh', 'V2ray、移动端和常见客户端配置方式。', tutorialArticles),
  buildCategory('浏览器操作教程', 'browser', 'AdsPower、紫鸟、候鸟、比特、MoreLogin 和 HubStudio。', tutorialArticles),
  buildCategory('腾讯云服务器', '789465', '云服务器和轻量应用服务器准备说明。', tutorialArticles),
];

export const newsCategories: PublicCategory[] = [
  buildCategory('代理 IP 资讯', 'kep', '住宅代理、静态代理、动态代理和代理类型知识。', newsArticles),
  buildCategory('购买指南', 'buying', '价格、服务商选择、购买误区和方案匹配。', newsArticles),
  buildCategory('采集与自动化', 'scraping', '采集代理、失败处理、请求节奏和自动化配置。', newsArticles),
  buildCategory('ISP 代理', 'isp', 'ISP 代理服务器、住宅代理和数据中心代理对比。', newsArticles),
  buildCategory('社媒与账号', 'social', '社媒运营、多账号环境和账号稳定性。', newsArticles),
  buildCategory('资源公示', 'resources', '原生 IP、ISP 核心段和地区资源信息。', newsArticles),
];

export const faqTopics = [
  {
    slug: 'proxy-selection',
    title: '动态 IP 和静态 IP 怎么选？',
    description: '围绕业务场景、稳定性、成本和纯净度选择合适的代理方案。',
    summary: '判断动态住宅代理、静态住宅代理和企业定制方案的 FAQ。',
    category: '产品选择',
  },
  {
    slug: 'use-cases',
    title: '不同业务场景应该怎么选代理 IP？',
    description: '按社媒、电商、采集、广告验证和 SEO 监控等场景找答案。',
    summary: '代理 IP 使用场景 FAQ。',
    category: '使用场景',
  },
] as const;

export function articleHref(kind: PublicContentKind, slug: string) {
  return `/${kind === 'news' ? 'news' : 'tutorials'}/article/${encodeURIComponent(slug)}`;
}

export function categoryHref(kind: PublicContentKind, slug: string) {
  return `/${kind === 'news' ? 'news' : 'tutorials'}/category/${encodeURIComponent(slug)}`;
}

export function faqHref(slug: string) {
  return slug ? `/faq/${encodeURIComponent(slug)}` : '/faq';
}

export function findNewsArticle(slug?: string) {
  return findBySlug(newsArticles, normalizeOfficialSlug(slug));
}

export function findTutorialArticle(slug?: string) {
  return findBySlug(tutorialArticles, normalizeOfficialSlug(slug));
}

export function findNewsCategory(slug?: string) {
  return findCategory(newsCategories, normalizeOfficialSlug(slug));
}

export function findTutorialCategory(slug?: string) {
  return findCategory(tutorialCategoryGroups, normalizeOfficialSlug(slug));
}

export function findFaqTopic(slug?: string) {
  const normalized = normalizeOfficialSlug(slug)
    .replace(/^faq_?/i, '')
    .replace(/^frequently_asked_questions$/i, 'faq');
  return faqTopics.find((topic) => topic.slug === normalized);
}

export function buildArticleBlocks(article: PublicArticle, kind: PublicContentKind): readonly PublicArticleBlock[] {
  if (kind === 'tutorial' && article.slug === 'tuiguang') {
    return promotionTutorialBlocks;
  }

  if (kind === 'tutorial') {
    return [
      { type: 'heading', level: 2, text: '适用场景' },
      { type: 'paragraph', text: `本教程适用于需要完成“${article.title}”相关配置或排查的用户。开始前请确认账号、资源、协议、端口和使用环境均来自平台真实后台。` },
      { type: 'divider' },
      { type: 'heading', level: 2, text: '操作前检查' },
      { type: 'paragraph', text: '先确认代理资源已经成功交付，并在我的代理、订单详情或后台记录中核对国家、城市、线路、协议、端口、账号密码和有效期。' },
      { type: 'heading', level: 2, text: '配置步骤' },
      { type: 'paragraph', text: article.description },
      { type: 'heading', level: 2, text: '排查建议' },
      { type: 'paragraph', text: '如果连接失败，优先检查白名单、账号密码、协议类型、端口、目标站点、DNS、浏览器环境和本地网络。不要把检测失败当作成功状态继续使用。' },
      { type: 'heading', level: 2, text: '结果核对' },
      { type: 'paragraph', text: '配置完成后通过代理检测、目标业务页面和订单/代理记录交叉核验。若存在扣款、履约、代理不可用等问题，应提交工单并附上订单编号和代理信息。' },
    ];
  }

  return [
    { type: 'heading', level: 2, text: '核心观点' },
    { type: 'paragraph', text: article.description },
    { type: 'divider' },
    { type: 'heading', level: 2, text: '适用业务' },
    { type: 'paragraph', text: `“${article.title}”主要服务于跨境访问、账号环境、采集自动化、广告验证、电商运营或企业网络测试等场景。不同场景需要按国家、城市、线路、会话稳定性和协议能力选择资源。` },
    { type: 'heading', level: 2, text: '选择重点' },
    { type: 'paragraph', text: '购买前应同时关注资源来源、地区准确度、可用库存、交付稳定性、售后响应、价格透明度和失败退款机制。只看价格或只看 IP 数量都容易造成实际成本上升。' },
    { type: 'heading', level: 2, text: '配置建议' },
    { type: 'paragraph', text: '使用时应保持浏览器环境、账号地区、目标业务地区和代理地区一致。若业务需要长期登录，优先考虑静态和稳定线路；若业务需要高频请求和分散访问，应评估动态代理和轮换策略。' },
    { type: 'heading', level: 2, text: '风险边界' },
    { type: 'paragraph', text: '代理资源不是万能兜底。违规场景、错误配置、目标平台限制、本地网络异常和上游资源变化都可能影响结果。所有购买、报价、交付和失败处理以平台真实后台记录为准。' },
  ];
}

const promotionTutorialBlocks = [
  { type: 'heading', level: 2, text: '关于推广计划' },
  { type: 'paragraph', text: 'ipmigo 推广计划面向真实用户和合作伙伴开放。用户可以通过专属邀请入口推荐好友注册，好友购买符合规则的标准代理产品后，邀请人可获得相应返佣奖励，最高可按实际消费金额的 10% 计算返佣。' },
  { type: 'paragraph', text: '该计划适合代理 IP 用户、跨境业务服务商、社群运营者、内容创作者以及拥有客户资源的渠道伙伴参与。推广越稳定，长期收益越清晰。' },
  {
    type: 'image',
    src: '/images/ipipd/tuiguang-rebate.png',
    alt: 'ipmigo 推广返佣介绍页面',
    title: 'ipmigo 推广返佣合作页面',
  },
  { type: 'divider' },
  { type: 'heading', level: 2, text: '一、如何参与 ipmigo 推广计划' },
  { type: 'paragraph', text: '登录账号后进入推广计划页面，即可查看自己的专属邀请码和推广链接。复制后分享给好友、客户或合作伙伴，对方通过专属入口完成注册并购买代理产品后，系统会记录推广关系。' },
  { type: 'divider' },
  { type: 'heading', level: 2, text: '二、推广流程' },
  { type: 'heading', level: 3, text: '1. 邀请好友' },
  { type: 'paragraph', text: '将专属邀请链接或邀请码分享给需要代理 IP 产品的用户。对方需要通过你的专属入口注册，平台才能识别并记录推广关系。' },
  { type: 'heading', level: 3, text: '2. 好友购买代理' },
  { type: 'paragraph', text: '好友注册后购买符合规则的标准代理产品。定制套餐、特殊报价或企业定制方案不计入标准返佣范围。' },
  { type: 'heading', level: 3, text: '3. 获得返佣奖励' },
  { type: 'paragraph', text: '订单满足规则后，返佣金额会进入推广计划记录。用户可以在后台核对总佣金、可提现金额、未结算金额、已提现金额、邀请用户和订单明细。' },
  { type: 'divider' },
  { type: 'heading', level: 2, text: '三、返佣规则' },
  {
    type: 'list',
    ordered: true,
    items: [
      '好友通过你的专属邀请链接或邀请码注册并完成有效购买后，可产生对应返佣。',
      '返佣仅适用于平台标准类型代理产品，定制套餐和特殊报价不参与返佣。',
      '若订单取消、退款或被判定为无效订单，对应佣金会同步撤销。',
      '返佣金额、订单状态、可提现金额和结算进度均以平台后台记录为准。',
    ],
  },
  { type: 'divider' },
  { type: 'heading', level: 2, text: '四、提现规则' },
  { type: 'paragraph', text: '可提现金额达到 CNY 100 后，可以提交提现申请。未达到门槛时佣金继续累计，达到门槛后再按后台流程申请。' },
  {
    type: 'list',
    items: ['总推荐用户', '总佣金', '可提现金额', '未结算金额', '已提现金额', '邀请记录', '单笔明细', '提现记录'],
  },
  { type: 'divider' },
  { type: 'heading', level: 2, text: '五、推广注意事项' },
  {
    type: 'list',
    items: [
      '真实、准确介绍产品，不夸大效果。',
      '不得进行虚假宣传。',
      '不得通过异常注册、虚假交易等方式获取返佣。',
    ],
  },
  { type: 'paragraph', text: 'ipmigo 代理产品需要在合适的海外业务环境中使用。推荐前应提醒用户确认业务场景、账号环境和使用条件是否匹配。' },
  { type: 'paragraph', text: '若客户无法判断原生住宅 IP、广播住宅 IP 或动态住宅 IP 是否适合当前业务，建议先咨询客服或小规模测试后再购买。' },
  { type: 'divider' },
  { type: 'heading', level: 2, text: '六、常见问题' },
  { type: 'heading', level: 3, text: '返佣比例是多少？' },
  { type: 'paragraph', text: '最高可按好友实际消费金额的 10% 计算返佣，具体比例以推广计划页面展示为准。' },
  { type: 'heading', level: 3, text: '多少钱可以提现？' },
  { type: 'paragraph', text: '可提现金额达到 CNY 100 后，可以申请提现。' },
  { type: 'heading', level: 3, text: '好友没有通过我的链接或邀请码注册，还能算返佣吗？' },
  { type: 'paragraph', text: '不能。推广关系需要通过专属邀请链接或邀请码建立，未绑定推广关系的订单不计入返佣。' },
  { type: 'heading', level: 3, text: '定制套餐代理可以参与返佣吗？' },
  { type: 'paragraph', text: '不可以。返佣仅适用于平台标准类型代理产品，定制套餐类型代理不适用此政策。' },
  { type: 'heading', level: 3, text: '订单退款后佣金还会保留吗？' },
  { type: 'paragraph', text: '不会。被邀请用户取消订阅、发生退款或订单被判定为无效订单时，对应佣金奖励会被撤销。' },
  { type: 'heading', level: 3, text: '在哪里查看推广收益？' },
  { type: 'paragraph', text: '登录后进入推广计划页面，可以查看邀请人数、订单明细、佣金金额、可提现金额和提现记录。' },
  { type: 'divider' },
  { type: 'heading', level: 2, text: '联系我们' },
  { type: 'paragraph', text: '如需了解更多产品信息或获取技术支持，请通过工单或在线客服沟通。' },
] satisfies readonly PublicArticleBlock[];

function buildCategory(title: string, slug: string, description: string, articles: PublicArticle[]): PublicCategory {
  return {
    slug,
    title,
    description,
    articles: articles.filter((article) => article.category === title),
  };
}

function findBySlug(articles: PublicArticle[], slug?: string) {
  const normalized = normalizeSlug(slug);
  return articles.find((article) => article.slug.toLowerCase() === normalized);
}

function findCategory(categories: PublicCategory[], slug?: string) {
  const normalized = normalizeSlug(slug);
  return categories.find((category) => category.slug.toLowerCase() === normalized || category.title.toLowerCase() === normalized);
}

function normalizeSlug(slug?: string) {
  if (!slug) {
    return '';
  }
  try {
    return decodeURIComponent(slug).replace(/\.html$/i, '').toLowerCase();
  } catch {
    return slug.replace(/\.html$/i, '').toLowerCase();
  }
}

function normalizeOfficialSlug(slug?: string) {
  const normalized = normalizeSlug(slug)
    .replace(/^en-us_?/i, '')
    .replace(/^news_article_/i, '')
    .replace(/^tutorials_article_/i, '')
    .replace(/^news_category_/i, '')
    .replace(/^tutorials_category_/i, '');

  const aliases: Record<string, string> = {
    '入门指引': '入门指引',
    'getting-started': '入门指引',
    getting_started: '入门指引',
    getting_started_guide: '入门指引',
    'frequently-asked-questions': 'qt',
    frequently_asked_questions: 'qt',
    faq: 'qt',
    qt: 'qt',
    client: 'kh',
    customer: 'kh',
    kh: 'kh',
    browser: 'browser',
    browsers: 'browser',
    浏览器操作教程: 'browser',
    cloud: '789465',
    cloud_server: '789465',
    'cloud-server': '789465',
    云服务器教程: '789465',
    腾讯云服务器: '789465',
    '789465': '789465',
    kep: 'kep',
    hzhb: 'resources',
  };

  return aliases[normalized] ?? normalized;
}
