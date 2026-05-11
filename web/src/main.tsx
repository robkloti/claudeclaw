import { render } from 'preact';
import { App } from './App';
import './styles/main.css';
import './lib/theme';       // initializes the theme effect on import
import './lib/api';         // initializes the dashboard token cache from URL
import { startChatStream } from './lib/chat-stream';
import { commandPaletteClientMode } from './lib/command-palette';
import { apiGet } from './lib/api';

// Single chat SSE for the lifetime of the page. Any view subscribes and
// the sidebar reads the unread count from the same signal.
startChatStream();

// Phase 4.2: prime the command-palette client_mode flag from /api/info so
// the palette filters operator-only navigation actions when the dashboard
// is running for a client.
apiGet<{ client_mode?: boolean }>('/api/info')
  .then((info) => {
    commandPaletteClientMode.value = info?.client_mode === true;
  })
  .catch(() => {
    // Fall through silently — palette defaults to operator mode (full nav).
  });

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
