"""Openly licensed dataset loaders for ``license: dataset-derived`` specs."""

from .base import (  # noqa: F401
    CACHE_DIR,
    DatasetLoader,
    DatasetRecord,
    DatasetSource,
    DatasetUnavailable,
    get_loader,
    register,
)

__all__ = [
    "CACHE_DIR", "DatasetLoader", "DatasetRecord", "DatasetSource",
    "DatasetUnavailable", "get_loader", "register",
]


def _main(argv=None) -> int:  # pragma: no cover - operator convenience
    """``python -m eeg_render.datasets fetch <dataset> <record>``"""
    import argparse
    p = argparse.ArgumentParser(prog="eeg_render.datasets")
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch", help="download one record into the local cache")
    f.add_argument("dataset")
    f.add_argument("record")
    args = p.parse_args(argv)
    loader = get_loader(args.dataset)
    path = loader.ensure(args.record)
    print(f"{path}  ({path.stat().st_size / 1e6:.1f} MB)")
    print(loader.attribution)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_main())
