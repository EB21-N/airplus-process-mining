"""Moteur d'analyse Air+ : meme code pour le dashboard et le notebook Colab."""
import datetime as dt
import os

from .analysis import analyze
from .common import ENGINE_VERSION
from .export import PseudonymizationError, build_zip, content_hash, read_analysis_zip
from .sources import SourceError

__all__ = ["run", "run_paths", "analyze", "build_zip", "read_analysis_zip", "content_hash", "SourceError", "PseudonymizationError", "ENGINE_VERSION"]


def run(mes_bytes, plm_bytes, erp_bytes, file_names=None):
    """Nettoie, rapproche, calcule, exporte. Renvoie (zip_bytes, analysis, manifest, identity)."""
    analysis, identity = analyze(mes_bytes, plm_bytes, erp_bytes, file_names)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    zip_bytes, manifest = build_zip(analysis, identity, generated_at=now)
    return zip_bytes, analysis, manifest, identity


def run_paths(mes_path, plm_path, erp_path):
    read = lambda p: open(p, "rb").read()
    names = {"mes": os.path.basename(mes_path), "plm": os.path.basename(plm_path), "erp": os.path.basename(erp_path)}
    return run(read(mes_path), read(plm_path), read(erp_path), names)
