export const AUTO_RECOMMENDED_LINE_LABEL = '\u81ea\u52a8\u5206\u914d';

export function isEnglishLanguage(language?: string): boolean {
  return language?.toLowerCase().startsWith('en') ?? false;
}

export function formatNetworkSequenceLabel(index: number, language?: string): string {
  const sequence = Math.max(0, index) + 1;
  return isEnglishLanguage(language) ? `Line ${sequence}` : `\u7ebf\u8def ${sequence}`;
}

export function formatDefaultAutoSelectLabel(language?: string): string {
  return isEnglishLanguage(language) ? 'Default automatic selection' : '\u9ed8\u8ba4\u81ea\u52a8\u9009\u62e9';
}

export function relabelNetworksBySequence<T extends { label: string }>(networks: T[], language?: string): T[] {
  return networks.map((network, index) => ({
    ...network,
    label: formatNetworkSequenceLabel(index, language),
  }));
}
