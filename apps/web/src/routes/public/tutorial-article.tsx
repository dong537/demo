import { useParams } from '@tanstack/react-router';
import './tutorial-article.css';
import {
  articleHref,
  buildArticleBlocks,
  categoryHref,
  findNewsArticle,
  findNewsCategory,
  findTutorialArticle,
  findTutorialCategory,
  newsArticles,
  newsCategories,
  type PublicArticle,
  type PublicArticleBlock,
  type PublicCategory,
  type PublicContentKind,
  tutorialArticles,
  tutorialCategoryGroups,
} from './public-content';

export function PublicTutorialArticlePage() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const article = findTutorialArticle(slug) ?? findTutorialArticle('tuiguang') ?? tutorialArticles[0];
  return <PublicArticleLayout active="教程" kind="tutorial" article={article} />;
}

export function PublicNewsArticlePage() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const article = findNewsArticle(slug) ?? newsArticles[0];
  return <PublicArticleLayout active="教程" kind="news" article={article} />;
}

export function PublicTutorialCategoryPage() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const category = findTutorialCategory(slug) ?? tutorialCategoryGroups[0];
  return <PublicCategoryLayout active="教程" kind="tutorial" category={category} categories={tutorialCategoryGroups} />;
}

export function PublicNewsCategoryPage() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const category = findNewsCategory(slug) ?? newsCategories[0];
  return <PublicCategoryLayout active="教程" kind="news" category={category} categories={newsCategories} />;
}

function PublicArticleLayout({
  active,
  kind,
  article,
}: {
  active: string;
  kind: PublicContentKind;
  article: PublicArticle;
}) {
  const groups = kind === 'tutorial' ? tutorialCategoryGroups : newsCategories;
  const articles = kind === 'tutorial' ? tutorialArticles : newsArticles;
  const blocks = buildArticleBlocks(article, kind);
  const index = Math.max(articles.findIndex((item) => item.slug === article.slug), 0);
  const previous = articles[(index - 1 + articles.length) % articles.length];
  const next = articles[(index + 1) % articles.length];
  const listHref = kind === 'tutorial' ? '/tutorials' : '/news';
  const listLabel = kind === 'tutorial' ? '教程' : '资讯';

  return (
    <div className="ipipd-tutorial">
      <ContentHeader active={active} />

      <div className="tutorial-shell">
        <ContentSidebar activeSlug={article.slug} groups={groups} kind={kind} />

        <main className="tutorial-article">
          <a className="tutorial-mobile-directory" href={listHref}>目录</a>
          <nav className="tutorial-breadcrumb" aria-label="面包屑">
            <a href="/">首页</a>
            <span>/</span>
            <a href={listHref}>{listLabel}</a>
            <span>/</span>
            <span>{article.title}</span>
          </nav>

          <article className="tutorial-card">
            <span className="tutorial-kicker">{article.category}</span>
            <h1 className="tutorial-sr-title">{article.title}</h1>
            <p className="tutorial-summary">{article.description}</p>
            <div className="tutorial-meta">
              <span>最近修改：{article.updatedAt}</span>
              <span>{kind === 'tutorial' ? 'ipmigo 教程' : 'ipmigo 资讯'}</span>
              <span>公开内容</span>
            </div>

            <div className="tutorial-content">
              {blocks.map((block, blockIndex) => (
                <ArticleBlock block={block} key={`${block.type}-${blockIndex}`} />
              ))}
            </div>
          </article>

          <nav className="tutorial-pager" aria-label="上下篇导航">
            <a href={articleHref(kind, previous.slug)}>
              <small>上一篇</small>
              <strong>{previous.title}</strong>
            </a>
            <a href={articleHref(kind, next.slug)}>
              <small>下一篇</small>
              <strong>{next.title}</strong>
            </a>
          </nav>
          <p className="tutorial-updated">最近修改：{article.updatedAt}</p>
        </main>
      </div>
    </div>
  );
}

function ArticleBlock({ block }: { block: PublicArticleBlock }) {
  if (block.type === 'heading') {
    return block.level === 3 ? <h3>{block.text}</h3> : <h2>{block.text}</h2>;
  }

  if (block.type === 'paragraph') {
    return <p>{block.text}</p>;
  }

  if (block.type === 'image') {
    return (
      <figure className="tutorial-figure">
        <img src={block.src} alt={block.alt} title={block.title} loading="lazy" />
      </figure>
    );
  }

  if (block.type === 'divider') {
    return <hr />;
  }

  const ListTag = block.ordered ? 'ol' : 'ul';
  return (
    <ListTag>
      {block.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ListTag>
  );
}

function PublicCategoryLayout({
  active,
  kind,
  category,
  categories,
}: {
  active: string;
  kind: PublicContentKind;
  category: PublicCategory;
  categories: PublicCategory[];
}) {
  const listHref = kind === 'tutorial' ? '/tutorials' : '/news';
  const listLabel = kind === 'tutorial' ? '教程' : '资讯';

  return (
    <div className="ipipd-tutorial">
      <ContentHeader active={active} />
      <div className="tutorial-shell">
        <ContentSidebar activeCategory={category.slug} groups={categories} kind={kind} />
        <main className="tutorial-article">
          <nav className="tutorial-breadcrumb" aria-label="面包屑">
            <a href="/">首页</a>
            <span>/</span>
            <a href={listHref}>{listLabel}</a>
            <span>/</span>
            <span>{category.title}</span>
          </nav>
          <article className="tutorial-card">
            <span className="tutorial-kicker">{listLabel}分类</span>
            <h1>{category.title}</h1>
            <p className="tutorial-summary">{category.description}</p>
            <div className="tutorial-category-list">
              {category.articles.map((article) => (
                <a className="tutorial-category-card" href={articleHref(kind, article.slug)} key={article.slug}>
                  <span>{article.category}</span>
                  <strong>{article.title}</strong>
                  <p>{article.description}</p>
                </a>
              ))}
            </div>
          </article>
        </main>
      </div>
    </div>
  );
}

function ContentHeader({ active }: { active: string }) {
  const nav = [
    ['首页', '/'],
    ['购买', '/pricing'],
    ['动态住宅', '/products/dynamic'],
    ['教程', '/tutorials'],
    ['推广返佣', '/promotion'],
    ['帮助中心', '/faq'],
  ];

  return (
    <header className="tutorial-header">
      <div className="tutorial-header-inner">
        <a className="tutorial-logo" href="/" aria-label="ipmigo 首页">
          <img src="/images/ipipd/logo.svg" alt="ipmigo" />
        </a>
        <nav className="tutorial-nav" aria-label="主导航">
          {nav.map(([label, href]) => (
            <a className={label === active ? 'active' : undefined} href={href} key={label}>{label}</a>
          ))}
        </nav>
        <div className="tutorial-actions">
          <a className="tutorial-link" href="/login">登录</a>
          <a className="tutorial-button" href="/register">注册</a>
        </div>
      </div>
    </header>
  );
}

function ContentSidebar({
  groups,
  kind,
  activeSlug,
  activeCategory,
}: {
  groups: PublicCategory[];
  kind: PublicContentKind;
  activeSlug?: string;
  activeCategory?: string;
}) {
  return (
    <aside className="tutorial-sidebar" aria-label="内容目录">
      {groups.map((group) => (
        <section className="tutorial-sidebar-group" key={group.slug}>
          <a className={`tutorial-sidebar-parent${group.slug === activeCategory ? ' active' : ''}`} href={categoryHref(kind, group.slug)}>
            <span>{group.title}</span>
            <span>›</span>
          </a>
          <div>
            {group.articles.slice(0, 8).map((article) => (
              <a
                className={`tutorial-sidebar-child${article.slug === activeSlug ? ' active' : ''}`}
                href={articleHref(kind, article.slug)}
                key={article.slug}
              >
                {article.title}
              </a>
            ))}
          </div>
        </section>
      ))}
    </aside>
  );
}
