import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';

registerSW({ immediate: true });

render(<App />, document.getElementById('root')!);
