import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// Ant Design + jsdom table/popover rendering can exceed Testing Library's 1s default
// when the complete feature suite is collected in one worker.
configure({ asyncUtilTimeout: 5000 });

// Ant Design requires window.matchMedia in jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom reports pseudo-element style reads as unimplemented. Ant Design only
// needs the element style to measure scrollbars in table and modal tests.
const jsdomGetComputedStyle = window.getComputedStyle.bind(window);
Object.defineProperty(window, 'getComputedStyle', {
  configurable: true,
  value: (element: Element) => jsdomGetComputedStyle(element),
});
