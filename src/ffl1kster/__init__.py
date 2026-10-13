"""FFL1kster: the Legend I toolkit of FFTOL (Tower of Legends) for The Final Fantasy Legend (USA).

Every layout in this package is derived from the Legend I ROM itself (docs/ffl1/); nothing is
assumed from Legend II. Generic, game-independent helpers (cartridge header, checksums, bank
math, byte patches, project manifest) are imported from ffl2kster unchanged.
"""

__version__ = "1.19.1"  # the repository version (pyproject.toml); ffl2kster keeps its own 1.0.0

__all__ = ["__version__"]
