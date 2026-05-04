import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Reference draft' },
  { to: '/draft-2', label: 'Draft 2' },
];

export function App() {
  return (
    <div className="flex h-full flex-col bg-base-100 text-base-content">
      <nav className="border-b border-base-300 bg-base-200 px-4 md:px-6 py-2 text-xs">
        <ul className="flex items-center gap-1">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `px-2 py-1 rounded-md transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-base-content/70 hover:bg-base-300 hover:text-base-content'
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}

export default App;
