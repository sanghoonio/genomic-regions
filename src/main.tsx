import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import App from './App';
import { MosaicCoordinatorProvider } from './contexts/MosaicCoordinatorProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MosaicCoordinatorProvider>
      <App />
    </MosaicCoordinatorProvider>
  </StrictMode>,
);
