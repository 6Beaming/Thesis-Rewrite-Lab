function Icon({ type }) {
  const paths = {
    docs: ['M7 4h8l4 4v12H7z', 'M15 4v5h4', 'M10 13h6', 'M10 16h6'],
    history: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 5v5h5', 'M12 7v5l3 2'],
    trash: ['M5 7h14', 'M9 7V5h6v2', 'M8 10l.5 9h7l.5-9'],
    support: ['M12 20a8 8 0 1 0-8-8', 'M9.5 10a2.5 2.5 0 1 1 3.8 2.1c-.8.5-1.3 1-1.3 2', 'M12 17h.1'],
    credits: ['M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.5 7.1 18.2l.9-5.5-4-3.9 5.5-.8z'],
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {(paths[type] || paths.docs).map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

const topItems = [
  { id: 'docs', label: 'Docs', icon: 'docs' },
  { id: 'versions', label: 'Version History', icon: 'history' },
  { id: 'trash', label: 'Trash', icon: 'trash' },
];

const bottomItems = [
  { id: 'support', label: 'Support', icon: 'support' },
  { id: 'credits', label: 'Credits For', icon: 'credits' },
];

export default function HomeSidebar({ active, onSelect, open = false }) {
  return (
    <aside className={`home-sidebar${open ? ' is-open' : ''}`} aria-label="Homepage navigation">
      <nav className="home-sidebar-nav">
        {topItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`home-sidebar-item${active === item.id ? ' is-active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <Icon type={item.icon} />
            {item.label}
          </button>
        ))}
      </nav>

      <nav className="home-sidebar-nav home-sidebar-nav--bottom">
        {bottomItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`home-sidebar-item${active === item.id ? ' is-active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <Icon type={item.icon} />
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
