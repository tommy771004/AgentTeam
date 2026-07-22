# Pi Host state is canonical

The Pi session store and Host run journal are the sole authorities for conversation and execution state. Renderer Zustand/localStorage contains only a disposable UI Projection; after renderer reload or Host restart, the client obtains a snapshot and resumes events after a cursor, and it never pushes cached state back as canonical data or participates in two-way conflict resolution.
