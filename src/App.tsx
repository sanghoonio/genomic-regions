import { Outlet } from 'react-router-dom';

export function App() {
  return (
    <div className="flex h-full flex-col bg-base-100 text-base-content">
      <Outlet />
    </div>
  );
}

export default App;
