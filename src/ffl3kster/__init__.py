"""FFL3kster: the Legend III toolkit of FFTOL (Tower of Legends) for Final Fantasy Legend III (USA).

Every layout in this package is derived from the Legend III ROM itself (docs/ffl3/); nothing is
assumed from Legend I or Legend II. Generic, game-independent helpers (cartridge header,
checksums, bank math, byte patches, project manifest) are imported from ffl2kster unchanged.
"""

__version__ = "1.24.0"  # the repository version (pyproject.toml); ffl2kster keeps its own 1.0.0

__all__ = ["__version__"]
