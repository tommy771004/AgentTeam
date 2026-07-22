# Load Pi extensions without runtime wrappers

SubAgents AI loads unmodified Pi extensions through the native Pi Extension API and does not require conversion into a proprietary runtime format. A Pi extension may optionally add a SubAgents Desktop Contribution manifest for typed settings controls and Electron/React surfaces, but that manifest is additive and its absence does not change extension execution semantics.
