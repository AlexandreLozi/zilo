import './catalog.css';
import { mount } from './app.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app root element');
mount(root, window.location.search);
