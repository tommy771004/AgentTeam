# Split product capabilities into domain Extension Packs

Capabilities outside Pi Core are organized as cohesive, manifest-declared Extension Packs such as Orchestration, Policy, Capabilities, Memory, Automation, Integrations, and Marketplace, rather than one monolith or one package per tool. Pi Core takes precedence whenever it provides behaviorally equivalent functionality: no duplicate extension is created, its native settings are surfaced in the Electron UI, and the Effective Agent Profile applies those values to the Pi runtime; packs own only settings and behavior absent from Pi.
