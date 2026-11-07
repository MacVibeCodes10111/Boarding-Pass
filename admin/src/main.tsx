import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../src/ui/fonts';
import { applyThemeToDocument } from '../../src/ui/kit';
import { Admin } from './Admin';

applyThemeToDocument();
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Admin />
  </React.StrictMode>,
);
