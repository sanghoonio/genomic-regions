import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './app.css';
import App from './App';
import { Home } from './pages/Home';
import { MosaicCoordinatorProvider } from './contexts/MosaicCoordinatorProvider';

const router = createBrowserRouter([
  {
    path: '/',
    Component: App,
    children: [
      { index: true, Component: Home },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MosaicCoordinatorProvider>
      <RouterProvider router={router} />
    </MosaicCoordinatorProvider>
  </StrictMode>,
);
