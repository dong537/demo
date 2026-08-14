import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './app/providers';
import './shared/theme/base.css';

const root = document.getElementById('root')!;
ReactDOM.createRoot(root).render(<Providers />);
