import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../src/ui/fonts';
import { applyThemeToDocument } from '../../src/ui/kit';
import { Admin } from './Admin';

applyThemeToDocument();
// The game's page style pins the page to the screen (the map fills it); the admin site is a normal
// page that scrolls. Added after the game's style, so it wins.
const scroll = document.createElement('style');
scroll.id = 'bp-admin-scroll';
scroll.textContent = `
  html, body, #root { width: auto; height: auto; min-height: 100%; overflow: visible; overscroll-behavior: auto; }
  html { overflow-y: auto; }
`;
document.head.appendChild(scroll);
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Admin />
  </React.StrictMode>,
);
