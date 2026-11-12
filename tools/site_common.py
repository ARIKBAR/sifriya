# Shared by the site pipeline: the building's plan (same numbers as js/scene.js),
# the map projection, and the fit of the model onto the real footprint.
import json, math
import numpy as np

# ---- the model's plan, in model units (see js/scene.js) ----
Q = [((-8.5, 2.4), 3.45, 0.12), ((6.3, 2.8), 2.45, 0.16), ((8.8, 0.0), 2.75, 0.10), ((-3.7, -4.5), 3.95, 0.06)]
SAG = [0.75, 0.05, 0.85, 0.10]
BOW = [0.32, 0.06, 0.55, 0.0]
GH = 1.05
LIBRARY_WAY = 1056806872


def lerp(a, b, t):
    return a + (b - a) * t


def edge_y(i, t):
    return lerp(Q[i][1], Q[(i + 1) % 4][1], t) - SAG[i] * math.sin(math.pi * t)


def outline(n_out=320):
    """Plan outline of the stone mass in model units: list of (x, z), plus edge heights."""
    P = [np.array(q[0], float) for q in Q]
    mid = sum(P) / 4
    pts = []
    for i in range(4):
        prev, cur, nxt = P[(i - 1) % 4], P[i], P[(i + 1) % 4]
        r = Q[i][2]
        a = cur + (prev - cur) / np.linalg.norm(prev - cur) * r
        b = cur + (nxt - cur) / np.linalg.norm(nxt - cur) * r
        for k in range(9):
            t = k / 8; s = 1 - t
            pts.append((a * s * s + cur * 2 * s * t + b * t * t, Q[i][1]))
        nA = nxt + (cur - nxt) / np.linalg.norm(cur - nxt) * Q[(i + 1) % 4][2]
        L = np.linalg.norm(nA - b); n = max(2, round(L * 6))
        nrm = np.array([-(nA[1] - b[1]), nA[0] - b[0]]); nrm /= np.linalg.norm(nrm)
        if nrm.dot(mid - b) < 0:
            nrm = -nrm
        for k in range(1, n):
            pts.append((b + (nA - b) * (k / n) + nrm * BOW[i] * math.sin(math.pi * k / n), edge_y(i, k / n)))
    seg = [0.0]
    for i in range(1, len(pts) + 1):
        seg.append(seg[-1] + np.linalg.norm(pts[i % len(pts)][0] - pts[i - 1][0]))
    per = seg[-1]; res = []; hs = []; j = 0
    for i in range(n_out):
        d = i / n_out * per
        while seg[j + 1] < d:
            j += 1
        t = (d - seg[j]) / ((seg[j + 1] - seg[j]) or 1)
        a, b = pts[j], pts[(j + 1) % len(pts)]
        res.append(a[0] + (b[0] - a[0]) * t); hs.append(lerp(a[1], b[1], t))
    return np.array(res), np.array(hs)


# ---- map projection: lat/lon → local metres (east, north) around the library ----
class Proj:
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = math.cos(math.radians(lat0)) * 111320.0
        self.ky = 110574.0

    def en(self, lat, lon):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)


def load_osm(path):
    return json.load(open(path, encoding='utf-8'))['elements']


def fit_model_to_footprint(foot_en):
    """Similarity transform (no mirror) taking model (x, -z) to map (east, north).
    Returns s (metres per unit), theta, t and the rms distance in metres."""
    model, _ = outline(320)
    m = model[:, 0] + 1j * (-model[:, 1])            # (x, -z) as complex
    f = np.array([complex(e, n) for e, n in foot_en])
    # dense samples of the real footprint boundary
    dense = []
    for i in range(len(f)):
        a, b = f[i], f[(i + 1) % len(f)]
        k = max(2, int(abs(b - a) / 0.5))
        dense += [a + (b - a) * j / k for j in range(k)]
    dense = np.array(dense)
    best = None
    for deg in range(0, 360, 5):
        rot = np.exp(1j * math.radians(deg))
        s = (abs(f - f.mean()).mean()) / (abs(m - m.mean()).mean())
        A = rot * s; t = f.mean() - A * m.mean()
        for _ in range(60):
            p = A * m + t
            idx = np.argmin(abs(p[:, None] - dense[None, :]), axis=1)
            q = dense[idx]
            mc, qc = m - m.mean(), q - q.mean()
            A = (qc * np.conj(mc)).sum() / (abs(mc) ** 2).sum()      # least-squares similarity
            t = q.mean() - A * m.mean()
        p = A * m + t
        d1 = np.min(abs(p[:, None] - dense[None, :]), axis=1)
        d2 = np.min(abs(dense[:, None] - p[None, :]), axis=1)        # both directions
        rms = math.sqrt((np.concatenate([d1, d2]) ** 2).mean())
        if best is None or rms < best[3]:
            best = (abs(A), math.atan2(A.imag, A.real), t, rms)
    return best


class ModelFrame:
    """Converts map metres (east, north) to model units (x, z)."""
    def __init__(self, s, theta, t):
        self.A = s * complex(math.cos(theta), math.sin(theta)); self.t = t; self.s = s; self.theta = theta

    def to_model(self, e, n):
        c = (complex(e, n) - self.t) / self.A
        return (c.real, -c.imag)

    def north(self):
        """direction of north in model (x, z)"""
        c = 1j / (self.A / abs(self.A))
        return (c.real, -c.imag)


# ---- the tour's camera keyframes (cam, look) — the same numbers as TRACKS.monolith in js/scene.js
CAM_KEYS = [
    ((5.6, 0.85, 12.6), (1.9, 1.25, 1.4)),
    ((4.6, 0.95, 13.0), (1.7, 1.3, 1.3)),
    ((-9.5, 2.3, 17.5), (-0.6, 1.75, -0.4)),
    ((-10.6, 2.7, 16.9), (-0.6, 1.8, -0.5)),
    ((-4.4, 12.6, 15.6), (0.1, 1.5, -0.7)),
    ((-2.6, 13.2, 15.0), (0.4, 1.5, -0.7)),
    ((17.4, 3.3, 11.6), (5.0, 1.7, 0.8)),
    ((18.0, 2.8, 10.4), (5.2, 1.65, 0.8)),
]
