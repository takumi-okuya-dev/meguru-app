"""docs/cost-estimate.md「総コストの試算」のグラフ（SVG）を作る。数字は文書の表の真ん中の値。"""
import json
import sys

OUT = sys.argv[1]

# 利用者の数 → 毎月の総コスト（円。表の真ん中の値）
POINTS = [(1, 1000), (5, 1450), (10, 1900), (20, 2900), (50, 3850), (100, 4200), (300, 4450), (1000, 6300)]
FIXED = 850

# 利用者の増え方の見込み（月末の利用者）
SCENARIOS = [
    ("はやい", "#2a78d6", [1, 5, 10, 20, 40, 60, 100, 150, 200, 250, 300, 400]),
    ("ふつう", "#eb6834", [1, 3, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100]),
    ("ゆっくり", "#1baf7a", [1, 2, 3, 5, 7, 10, 12, 15, 17, 20, 22, 25]),
]

SURFACE = "#fcfcfb"
TEXT1 = "#0b0b0b"
TEXT2 = "#52514e"
GRID = "#e4e3df"
FONT = "'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif"


def cost(users: float) -> float:
    """表の点のあいだを直線でつなぐ。"""
    for (u0, c0), (u1, c1) in zip(POINTS, POINTS[1:]):
        if u0 <= users <= u1:
            return c0 + (c1 - c0) * (users - u0) / (u1 - u0)
    return POINTS[-1][1]


def yen(v: float) -> str:
    return f"{round(v / 10) * 10:,.0f}円"


def frame(w, h, title, sub):
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{title}">',
        f'<rect width="{w}" height="{h}" fill="{SURFACE}" rx="8"/>',
        f'<text x="24" y="34" font-family="{FONT}" font-size="17" font-weight="600" fill="{TEXT1}">{title}</text>',
        f'<text x="24" y="56" font-family="{FONT}" font-size="12" fill="{TEXT2}">{sub}</text>',
    ]


def y_axis(out, x0, x1, top, bottom, ymax, step):
    v = 0
    while v <= ymax:
        y = bottom - (bottom - top) * v / ymax
        out.append(f'<line x1="{x0}" x2="{x1}" y1="{y:.1f}" y2="{y:.1f}" stroke="{GRID}" stroke-width="1"/>')
        out.append(
            f'<text x="{x0 - 8}" y="{y + 4:.1f}" text-anchor="end" font-family="{FONT}" font-size="11" fill="{TEXT2}">{v:,}</text>'
        )
        v += step


def by_users():
    w, h = 760, 400
    x0, x1, top, bottom = 70, 736, 80, 340
    ymax = 7000
    out = frame(w, h, "利用者の数ごとの、毎月の総コスト", "棒＝合計（円・消費税なし）。点線＝固定費（コードの置き場とドメインで月850円）")
    y_axis(out, x0, x1, top, bottom, ymax, 1000)
    n = len(POINTS)
    slot = (x1 - x0) / n
    bw = slot * 0.5
    for i, (u, c) in enumerate(POINTS):
        cx = x0 + slot * (i + 0.5)
        y = bottom - (bottom - top) * c / ymax
        hgt = bottom - y
        # 上だけ角を丸める（4px）
        out.append(
            f'<path d="M{cx - bw / 2:.1f},{bottom} V{y + 4:.1f} Q{cx - bw / 2:.1f},{y:.1f} {cx - bw / 2 + 4:.1f},{y:.1f} '
            f'H{cx + bw / 2 - 4:.1f} Q{cx + bw / 2:.1f},{y:.1f} {cx + bw / 2:.1f},{y + 4:.1f} V{bottom} Z" fill="#2a78d6"/>'
        )
        out.append(
            f'<text x="{cx:.1f}" y="{y - 8:.1f}" text-anchor="middle" font-family="{FONT}" font-size="12" fill="{TEXT1}">{yen(c)}</text>'
        )
        out.append(
            f'<text x="{cx:.1f}" y="{bottom + 20}" text-anchor="middle" font-family="{FONT}" font-size="12" fill="{TEXT2}">{u:,}人</text>'
        )
    fy = bottom - (bottom - top) * FIXED / ymax
    out.append(f'<line x1="{x0}" x2="{x1}" y1="{fy:.1f}" y2="{fy:.1f}" stroke="{TEXT2}" stroke-width="2" stroke-dasharray="6 4"/>')
    out.append(f'<line x1="{x0}" x2="{x1}" y1="{bottom}" y2="{bottom}" stroke="{TEXT2}" stroke-width="1"/>')
    out.append(f'<text x="{(x0 + x1) / 2}" y="{h - 14}" text-anchor="middle" font-family="{FONT}" font-size="12" fill="{TEXT2}">利用者の数</text>')
    out.append("</svg>")
    return "\n".join(out)


def by_month():
    w, h = 800, 420
    x0, x1, top, bottom = 70, 640, 80, 350
    ymax = 5000
    out = frame(w, h, "利用者の増え方ごとの、毎月の総コスト（12か月）", "線＝毎月の総コスト（円・消費税なし）。右の数字は12か月目の利用者と費用")
    y_axis(out, x0, x1, top, bottom, ymax, 1000)
    months = 12
    xs = [x0 + (x1 - x0) * i / (months - 1) for i in range(months)]
    for i, x in enumerate(xs):
        out.append(
            f'<text x="{x:.1f}" y="{bottom + 20}" text-anchor="middle" font-family="{FONT}" font-size="12" fill="{TEXT2}">{i + 1}</text>'
        )
    out.append(f'<line x1="{x0}" x2="{x1}" y1="{bottom}" y2="{bottom}" stroke="{TEXT2}" stroke-width="1"/>')
    fy = bottom - (bottom - top) * FIXED / ymax
    out.append(f'<line x1="{x0}" x2="{x1}" y1="{fy:.1f}" y2="{fy:.1f}" stroke="{TEXT2}" stroke-width="2" stroke-dasharray="6 4"/>')
    out.append(f'<text x="{x1}" y="{fy + 16:.1f}" text-anchor="end" font-family="{FONT}" font-size="11" fill="{TEXT2}">固定費 850円</text>')
    label_y = []
    for name, color, users in SCENARIOS:
        pts = [(xs[i], bottom - (bottom - top) * cost(u) / ymax) for i, u in enumerate(users)]
        path = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        out.append(f'<polyline points="{path}" fill="none" stroke="{color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>')
        for x, y in pts:
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="{color}" stroke="{SURFACE}" stroke-width="2"/>')
        ly = pts[-1][1]
        # ラベルが重ならないよう、近ければずらす
        for prev in label_y:
            if abs(prev - ly) < 34:
                ly = prev + 34 if ly >= prev else prev - 34
        label_y.append(ly)
        out.append(f'<circle cx="{x1 + 14}" cy="{ly - 4:.1f}" r="5" fill="{color}"/>')
        out.append(f'<text x="{x1 + 24}" y="{ly:.1f}" font-family="{FONT}" font-size="13" font-weight="600" fill="{TEXT1}">{name}</text>')
        out.append(
            f'<text x="{x1 + 24}" y="{ly + 16:.1f}" font-family="{FONT}" font-size="11" fill="{TEXT2}">{users[-1]}人・{yen(cost(users[-1]))}</text>'
        )
    out.append(f'<text x="{(x0 + x1) / 2}" y="{h - 14}" text-anchor="middle" font-family="{FONT}" font-size="12" fill="{TEXT2}">公開してからの月</text>')
    out.append("</svg>")
    return "\n".join(out)


open(f"{OUT}/cost-by-users.svg", "w").write(by_users() + "\n")
open(f"{OUT}/cost-by-month.svg", "w").write(by_month() + "\n")

# 文書の表に使う数字
table = {}
for name, _, users in SCENARIOS:
    monthly = [round(cost(u) / 10) * 10 for u in users]
    table[name] = {"users": users, "monthly": monthly, "total12": sum(monthly)}
print(json.dumps(table, ensure_ascii=False))
