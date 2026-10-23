import { render } from 'preact';
import { App } from './App';
import styles from './styles.css';
import { browserTransport, inVsCode, vscodeTransport } from './transport';

const style = document.createElement('style');
style.textContent = styles;
document.head.appendChild(style);

// The same bundle runs in VS Code webviews and on the browser page.
const transport = inVsCode() ? vscodeTransport() : browserTransport();

render(<App transport={transport} />, document.getElementById('root')!);
