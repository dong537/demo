import { describe, expect, it } from 'vitest';
import {
  formatDefaultAutoSelectLabel,
  formatNetworkSequenceLabel,
  relabelNetworksBySequence,
} from './resource-selection-labels';

describe('resource selection labels', () => {
  it('keeps Chinese labels by default', () => {
    expect(formatNetworkSequenceLabel(0)).toBe('线路 1');
    expect(formatNetworkSequenceLabel(1, 'zh-CN')).toBe('线路 2');
  });

  it('formats sequence labels in English when the active language is English', () => {
    expect(formatNetworkSequenceLabel(0, 'en')).toBe('Line 1');
    expect(formatNetworkSequenceLabel(1, 'en-US')).toBe('Line 2');
    expect(relabelNetworksBySequence([{ label: 'old' }], 'en')[0]?.label).toBe('Line 1');
  });

  it('formats the default automatic choice label by language', () => {
    expect(formatDefaultAutoSelectLabel()).toBe('\u9ed8\u8ba4\u81ea\u52a8\u9009\u62e9');
    expect(formatDefaultAutoSelectLabel('en-US')).toBe('Default automatic selection');
  });
});
