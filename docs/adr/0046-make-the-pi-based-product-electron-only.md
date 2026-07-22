# Make the Pi-based product Electron-only

The Pi-based SubAgents product runs only through Electron because Pi Core, Trusted Extensions, tools, and the Pi Core Host require a supervised Node-capable utility process. The plain Vite browser runtime and mock agent fallback are removed at cutover rather than maintained as a second runtime; UI development and automated verification launch Electron against the same typed Host protocol used in production.
