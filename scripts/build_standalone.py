#!/usr/bin/env python3
"""
Build self-contained standalone HTML files by inlining all CSS, JS, and JSON data.

Produces:
  docs/standalone/dashboard.html   (from docs/index.html)
  docs/standalone/evaluations.html (from docs/evaluations.html)
"""

import json
import os
import re
import sys

DOCS_DIR = os.path.join(os.path.dirname(__file__), "..", "docs")
DOCS_DIR = os.path.abspath(DOCS_DIR)
OUT_DIR = os.path.join(DOCS_DIR, "standalone")


def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def collect_data_files():
    """Collect all JSON data files into a dict keyed by relative path (e.g. 'data/foo.json')."""
    data = {}
    data_dir = os.path.join(DOCS_DIR, "data")

    # Top-level JSON files in data/
    for fname in os.listdir(data_dir):
        fpath = os.path.join(data_dir, fname)
        if fname.endswith(".json") and os.path.isfile(fpath):
            key = f"data/{fname}"
            data[key] = read_json(fpath)

    # Trajectory subdirectories
    for subdir in ("trajectories", "trajectories_lop"):
        subdir_path = os.path.join(data_dir, subdir)
        if not os.path.isdir(subdir_path):
            continue
        for fname in os.listdir(subdir_path):
            if fname.endswith(".json"):
                fpath = os.path.join(subdir_path, fname)
                key = f"data/{subdir}/{fname}"
                data[key] = read_json(fpath)

    return data


def build_data_script(data_dict):
    """Build a <script> block that sets window.__INLINE_DATA__ and monkey-patches d3.json."""
    json_blob = json.dumps(data_dict, separators=(",", ":"))
    return f"""<script>
window.__INLINE_DATA__ = {json_blob};

// Monkey-patch d3.json to serve inlined data
(function() {{
  var _origD3Json = d3.json;
  d3.json = function(url) {{
    var key = url;
    if (key.startsWith('./')) key = key.slice(2);
    if (window.__INLINE_DATA__[key] !== undefined) {{
      return Promise.resolve(JSON.parse(JSON.stringify(window.__INLINE_DATA__[key])));
    }}
    return _origD3Json.apply(this, arguments);
  }};
}})();
</script>"""


def inline_css(html):
    """Replace <link rel="stylesheet" href="css/..."> with inline <style> tags."""
    def replacer(match):
        href = match.group(1)
        css_path = os.path.join(DOCS_DIR, href)
        if os.path.isfile(css_path):
            css_content = read_file(css_path)
            return f"<style>\n{css_content}\n</style>"
        return match.group(0)

    return re.sub(
        r'<link\s+rel="stylesheet"\s+href="(css/[^"]+)"\s*/?>',
        replacer,
        html,
    )


def inline_js(html):
    """Replace <script src="js/..."> with inline <script> tags."""
    def replacer(match):
        src = match.group(1)
        js_path = os.path.join(DOCS_DIR, src)
        if os.path.isfile(js_path):
            js_content = read_file(js_path)
            return f"<script>\n{js_content}\n</script>"
        return match.group(0)

    return re.sub(
        r'<script\s+src="(js/[^"]+)">\s*</script>',
        replacer,
        html,
    )


def inject_data_script(html, data_script):
    """Insert the data script AFTER the last CDN <script> and BEFORE any js/ <script>."""
    # Find the last CDN script (https://...)
    cdn_pattern = r'(<script\s+src="https://[^"]+"></script>)'
    cdn_matches = list(re.finditer(cdn_pattern, html))
    if cdn_matches:
        last_cdn = cdn_matches[-1]
        insert_pos = last_cdn.end()
        html = html[:insert_pos] + "\n" + data_script + "\n" + html[insert_pos:]
    return html


def update_nav_links(html):
    """Update navigation links to point to standalone versions."""
    html = html.replace('href="index.html"', 'href="dashboard.html"')
    html = html.replace('href="evaluations.html"', 'href="evaluations.html"')
    return html


def build_standalone(html_filename, output_filename):
    """Build a standalone HTML file."""
    html_path = os.path.join(DOCS_DIR, html_filename)
    html = read_file(html_path)

    # Collect all data files
    data_dict = collect_data_files()
    data_script = build_data_script(data_dict)

    # 1. Inline CSS
    html = inline_css(html)

    # 2. Inject data script after CDN scripts
    html = inject_data_script(html, data_script)

    # 3. Inline JS (must come after data injection so the script tags are still external refs)
    html = inline_js(html)

    # 4. Update nav links
    html = update_nav_links(html)

    # Write output
    out_path = os.path.join(OUT_DIR, output_filename)
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"  {out_path} ({size_mb:.1f} MB)")


def main():
    print("Building standalone HTML files...")
    print()

    build_standalone("index.html", "dashboard.html")
    build_standalone("evaluations.html", "evaluations.html")

    print()
    print("Done.")


if __name__ == "__main__":
    main()
