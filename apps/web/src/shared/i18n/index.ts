import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './zh';

void i18next.use(initReactI18next).init({
  lng: 'zh',
  fallbackLng: 'zh',
  resources: { zh: { translation: zh } },
  interpolation: { escapeValue: false },
});

export default i18next;
