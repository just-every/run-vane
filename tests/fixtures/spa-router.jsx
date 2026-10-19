// INSTALL-007 fixture: a React app routed by TanStack Router through the History API, or through #/ hash routes
// when the page sets window.FIXTURE_HASH. Bundled by the test with esbuild.
import { createRoot } from 'react-dom/client'
import { createBrowserHistory, createHashHistory, createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from '@tanstack/react-router'
const paths = ['/', '/pricing', '/docs', '/about']
const root = createRootRoute({ component: () => <><nav>{paths.map(to => <Link key={to} to={to}>{'Go ' + to}</Link>)}</nav><Outlet /></> })
const routes = paths.map(path => createRoute({ getParentRoute: () => root, path, component: () => <h1>{'View ' + path}</h1> }))
const router = createRouter({ routeTree: root.addChildren(routes), history: window.FIXTURE_HASH ? createHashHistory() : createBrowserHistory() })
createRoot(document.getElementById('app')).render(<RouterProvider router={router} />)
