"""Add gallery scale legends from actual sidecars and authored styles after rendering.

python scripts/eeg-gallery-legends.py <catalog-dir> [--manifest <site-or-catalog-json>]
"""
from pathlib import Path
import argparse
import json
import sys

import numpy as np
import yaml
from matplotlib.colors import to_hex

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/eeg-render'))
from eeg_render.spec import normalize
from eeg_render.style import spectrogram_cmap

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('catalog_dir', type=Path)
parser.add_argument('--manifest', type=Path)
args = parser.parse_args()
directory = args.catalog_dir
manifest_path = args.manifest or directory / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf8'))
specs = {item['id']: item for file in (directory / 'catalog').glob('*.yaml')
         for item in yaml.safe_load(file.read_text(encoding='utf8'))['items']}

for item in manifest['items']:
    kind = item['kind']
    if kind == 'eeg_page':
        continue
    spec = normalize(specs[item['id']]['image'])['spec']
    panel = spec['qeeg_panel'] if kind == 'composite' else spec
    style = panel.get('style', {})
    side = json.loads((directory / 'renders' / f'{item["id"]}.json').read_text(encoding='utf8'))
    names = [p['name'] for p in side.get('panels', [])]
    lines = []
    if kind == 'aeeg' or any(name.startswith('aeeg_') for name in names):
        lines.append('aEEG amplitude: µV; linear to 10 µV, logarithmic above 10 µV.'
                     if style.get('aeeg_axis', 'semilog') != 'linear'
                     else 'aEEG amplitude: µV on a linear axis.')
    if any(name.startswith(('fft_', 'rhythmicity_', 'asymmetry_relative')) for name in names):
        lines.append('Spectrogram vertical axes: frequency in Hz.')
    if any(name.startswith('rhythmicity_') for name in names):
        lines.append('Rhythmicity: relative score; brighter colors mean stronger rhythmicity, not dB.')
    if any(name in ('suppression_ratio', 'suppression_ratio_L', 'suppression_ratio_R', 'asymmetry_index') for name in names):
        lines.append('Suppression and asymmetry: percent; use each panel’s labeled limits.')
    if 'seizure_probability' in names:
        lines.append('Seizure probability: heuristic score from 0 to 1.')
    if any(name.startswith('alpha_delta_ratio') for name in names):
        lines.append('Alpha/delta ratio: unitless.')
    if kind == 'composite':
        lines.append('Raw EEG calibration bar: 50 µV vertical · 1 second horizontal.')
    elif kind == 'aeeg' and 'raw_strip' in names:
        lines.append('Raw excerpt calibration bar: 50 µV vertical; its horizontal ruler is seconds.')
    lines.append('Trend time follows the labeled horizontal axis; raw EEG excerpts use seconds.')
    legend = {'lines': lines}
    ranges = list(side.get('db_ranges', {}).values())
    if not ranges and kind == 'composite' and any(name.startswith('fft_') for name in names):
        if style.get('fft_db_range'):
            ranges = [style['fft_db_range']]
    if ranges and all(value == ranges[0] for value in ranges):
        cmap = spectrogram_cmap(style.get('spectrogram_cmap', 'pedquest_power'))
        legend['lines'].insert(0, 'FFT power: dB, using this image’s range and palette.')
        legend['power'] = {'range': ranges[0], 'colors': [to_hex(color) for color in cmap(np.linspace(0, 1, 17))]}
    item['scaleLegend'] = legend

manifest_path.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + '\n', encoding='utf8')
print(f'Updated legends for {sum("scaleLegend" in item for item in manifest["items"])} trend/aEEG/composite examples.')
