// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { ToastHost, applyTheme, readThemePref } from './lib';

// Set the theme before the first paint so the page doesn't flash.
applyTheme(readThemePref());

createRoot(document.getElementById('root')!).render(<ToastHost><App /></ToastHost>);
