import { createRoot } from 'react-dom/client';
import App from './App';
import { GameRuntime } from './game/runtime';
import './styles.css';

const runtime = new GameRuntime(document.getElementById('game-host')!);
const root = createRoot(document.getElementById('root')!);
root.render(<App runtime={runtime} />);
void runtime.init();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
    runtime.destroy();
  });
}
