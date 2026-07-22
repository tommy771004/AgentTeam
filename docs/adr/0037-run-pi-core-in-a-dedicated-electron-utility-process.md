# Run Pi Core in a dedicated Electron utility process

Pi Core, AgentSessionRuntime instances, tools, and Trusted Extensions execute in a dedicated Electron utility process supervised by Electron main. The renderer communicates only through the typed Pi Core Host protocol, while main owns process lifecycle, health checks, secrets, and OS capability bridges; a failed or wedged agent runtime can therefore be restarted and resumed from Pi session state without directly taking down the desktop window.
