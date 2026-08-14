import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ConfigProvider } from 'antd';
import { I18nextProvider } from 'react-i18next';
import i18n from '../shared/i18n';
import { buildApiUrl, publicSiteHeaders } from '../shared/api/client';
import { formatBrandName } from '../shared/site/brand-display';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

const FONT_FAMILY =
  '"PingFang SC", "Microsoft YaHei", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';
const HEADING_FONT_FAMILY =
  '"Urbanist", "PingFang SC", "Microsoft YaHei", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const DEFAULT_PRIMARY = '#003afe';

interface BrandConfig {
  name?: string;
  siteName?: string;
  primaryColor?: string;
}

interface CurrentSiteResponse {
  site?: { name?: string; brandConfig?: BrandConfig | null } | null;
  tenant?: { name?: string; brandConfig?: BrandConfig | null } | null;
}

export function Providers() {
  const [brand, setBrand] = React.useState<BrandConfig>({});
  const primaryColor = brand.primaryColor ?? DEFAULT_PRIMARY;

  React.useEffect(() => {
    fetch(buildApiUrl('/api/sites/current'), { headers: publicSiteHeaders() })
      .then((r) => r.json())
      .then((json) => {
        const data = json?.data as CurrentSiteResponse | undefined;
        const config: BrandConfig = {
          ...(data?.site?.brandConfig ?? {}),
          ...(data?.tenant?.brandConfig ?? {}),
        };
        const name = formatBrandName(config.name || config.siteName || data?.tenant?.name || data?.site?.brandConfig?.name || data?.site?.name);
        if (name) config.name = name;
        setBrand(config);
        if (config.name) document.title = config.name;
      })
      .catch(() => {});
  }, []);

  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider
          theme={{
            token: {
              colorPrimary: primaryColor,
              colorPrimaryHover: '#002dcc',
              colorPrimaryActive: '#0024a3',
              colorInfo: primaryColor,
              colorSuccess: '#00bc7d',
              colorWarning: '#fe9a00',
              colorError: '#ec003f',
              colorBgLayout: '#fafafc',
              colorBgContainer: '#ffffff',
              colorBgElevated: '#ffffff',
              colorFillSecondary: '#f6f6f6',
              colorFillTertiary: '#fafafc',
              colorText: '#1f2329',
              colorTextSecondary: '#45556c',
              colorTextTertiary: '#8b8f97',
              colorBorder: '#d8d8d8',
              colorBorderSecondary: '#e8e8e8',
              colorLink: primaryColor,
              margin: 14,
              marginXS: 8,
              marginSM: 10,
              marginMD: 14,
              marginLG: 18,
              padding: 14,
              paddingXS: 8,
              paddingSM: 10,
              paddingMD: 14,
              paddingLG: 18,
              controlHeight: 34,
              controlHeightSM: 28,
              controlHeightLG: 40,
              controlItemBgActive: '#eef3ff',
              controlItemBgHover: '#fafafc',
              borderRadius: 7,
              borderRadiusSM: 5,
              borderRadiusLG: 8,
              boxShadow: '0 10px 26px rgba(28, 43, 84, 0.055)',
              boxShadowSecondary: '0 6px 18px rgba(28, 43, 84, 0.05)',
              fontFamily: FONT_FAMILY,
              fontSize: 14,
              fontSizeHeading1: 26,
              fontSizeHeading2: 22,
              fontSizeHeading3: 19,
              fontWeightStrong: 650,
              lineHeight: 1.55,
            },
            components: {
              Alert: {
                borderRadiusLG: 8,
                defaultPadding: '10px 14px',
                withDescriptionPadding: '13px 16px',
              },
              Badge: {
                fontSizeSM: 10,
                indicatorHeightSM: 14,
                textFontSizeSM: 10,
                textFontWeight: 700,
              },
              Button: {
                borderRadius: 6,
                controlHeight: 34,
                controlHeightSM: 28,
                controlHeightLG: 40,
                paddingInline: 13,
                paddingInlineSM: 10,
                paddingInlineLG: 18,
                fontWeight: 600,
                primaryShadow: 'none',
              },
              Card: {
                borderRadiusLG: 7,
                headerFontSize: 14,
                headerFontSizeSM: 14,
                headerHeight: 42,
                padding: 12,
                paddingLG: 16,
              },
              Drawer: {
                paddingLG: 16,
              },
              Dropdown: {
                borderRadiusLG: 8,
                controlPaddingHorizontal: 10,
                controlHeight: 32,
                fontSize: 13,
              },
              Descriptions: {
                itemPaddingBottom: 10,
                labelBg: '#fafafc',
                titleMarginBottom: 12,
              },
              Empty: {
                fontSize: 13,
              },
              Form: {
                itemMarginBottom: 12,
                labelColor: '#45556c',
                labelFontSize: 12,
                labelHeight: 20,
                verticalLabelPadding: '0 0 6px',
              },
              Input: {
                borderRadius: 6,
                controlHeight: 34,
                paddingInline: 10,
              },
              Menu: {
                itemBorderRadius: 6,
                itemHeight: 40,
                itemMarginInline: 0,
                itemMarginBlock: 1,
                itemSelectedBg: '#eef3ff',
                itemSelectedColor: primaryColor,
                itemHoverBg: '#fafafc',
                itemHoverColor: '#1f2329',
                groupTitleColor: '#8b8f97',
                iconSize: 16,
                collapsedIconSize: 16,
                itemPaddingInline: 13,
                subMenuItemBg: 'transparent',
              },
              Message: {
                borderRadiusLG: 8,
                contentPadding: '9px 12px',
              },
              Modal: {
                borderRadiusLG: 7,
                headerBg: '#ffffff',
                contentBg: '#ffffff',
                titleFontSize: 15,
                titleLineHeight: 1.45,
              },
              Pagination: {
                borderRadius: 6,
                controlHeight: 28,
                itemActiveBg: '#eef3ff',
                itemSize: 28,
                itemSizeSM: 24,
              },
              Popover: {
                borderRadiusLG: 8,
              },
              Select: {
                borderRadius: 6,
                controlHeight: 34,
              },
              Segmented: {
                borderRadius: 7,
                borderRadiusSM: 6,
                itemSelectedBg: '#ffffff',
                trackBg: '#f2f5ff',
              },
              Skeleton: {
                borderRadius: 8,
                gradientFromColor: '#f3f5fa',
                gradientToColor: '#e9eef8',
              },
              Steps: {
                colorTextDescription: '#45556c',
                customIconFontSize: 18,
                descriptionMaxWidth: 180,
                dotSize: 8,
                iconSize: 28,
                titleLineHeight: 1.35,
              },
              Statistic: {
                titleFontSize: 13,
                contentFontSize: 26,
                fontFamily: HEADING_FONT_FAMILY,
              },
              Table: {
                borderColor: '#dfe5ef',
                headerBg: '#fbfcff',
                headerColor: '#334155',
                headerSplitColor: '#e2e8f0',
                rowHoverBg: '#f7fbff',
                rowSelectedBg: '#eef3ff',
                rowSelectedHoverBg: '#e5eeff',
                rowExpandedBg: '#f9fbff',
                bodySortBg: '#fafcff',
                cellFontSize: 13,
                cellFontSizeMD: 13,
                cellFontSizeSM: 12,
                headerBorderRadius: 8,
                headerSortActiveBg: '#eef3ff',
                headerSortHoverBg: '#f4f8ff',
                headerFilterHoverBg: '#f4f8ff',
                cellPaddingBlock: 8,
                cellPaddingBlockMD: 6,
                cellPaddingBlockSM: 5,
                cellPaddingInline: 10,
                cellPaddingInlineMD: 9,
                cellPaddingInlineSM: 8,
                selectionColumnWidth: 40,
                fixedHeaderSortActiveBg: '#eef3ff',
                stickyScrollBarBg: 'rgba(0, 58, 254, 0.16)',
                stickyScrollBarBorderRadius: 999,
              },
              Tabs: { itemSelectedColor: primaryColor },
              Tag: { borderRadiusSM: 999 },
              Tooltip: {
                borderRadius: 7,
                colorBgSpotlight: '#1f2329',
                fontSize: 12,
              },
              Layout: { siderBg: '#ffffff', bodyBg: '#fafafc', headerBg: '#ffffff' },
              Typography: { titleMarginBottom: 0 },
            },
          }}
        >
          <RouterProvider router={router} />
        </ConfigProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
