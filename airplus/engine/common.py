"""Utilitaires partages par le moteur (conversion des valeurs sources, sans aucune hypothese metier)."""
import datetime as dt
import re
import unicodedata

ENGINE_VERSION = "1.0.0"


def norm_key(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def to_seconds(v):
    """Convertit une duree Excel en secondes entieres. None si non exploitable (jamais de valeur par defaut)."""
    if v is None or v == "":
        return None
    if isinstance(v, dt.datetime):  # Excel > 24 h : serie de date a partir de 1899-12-30/31
        base = dt.datetime(1899, 12, 30)
        return int(round((v - base).total_seconds()))
    if isinstance(v, dt.time):
        return v.hour * 3600 + v.minute * 60 + v.second
    if isinstance(v, dt.timedelta):
        return int(round(v.total_seconds()))
    if isinstance(v, (int, float)):
        return int(round(float(v) * 86400))
    m = re.fullmatch(r"\s*(\d+):(\d{2})(?::(\d{2}))?\s*", str(v))
    if m:
        return int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3] or 0)
    return None


def to_clock(v):
    """Heure de la journee en secondes (bornes d'horodatage)."""
    if isinstance(v, dt.datetime):
        return v.hour * 3600 + v.minute * 60 + v.second
    return to_seconds(v)


def to_date(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    m = re.fullmatch(r"\s*(\d{4})-(\d{2})-(\d{2}).*", str(v or ""))
    if m:
        return dt.date(int(m[1]), int(m[2]), int(m[3]))
    m = re.fullmatch(r"\s*(\d{2})/(\d{2})/(\d{4}).*", str(v or ""))
    if m:
        return dt.date(int(m[3]), int(m[2]), int(m[1]))
    return None


def to_float(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    t = str(v).strip().replace(" ", "").replace(" ", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def to_int(v):
    f = to_float(v)
    return None if f is None else int(f)


def clean(v):
    if v is None:
        return None
    t = str(v).strip()
    return t or None


def hms(sec):
    if sec is None:
        return None
    sign = "-" if sec < 0 else ""
    sec = abs(int(sec))
    return f"{sign}{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def rnd(x, n=2):
    return None if x is None else round(x, n)


WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
