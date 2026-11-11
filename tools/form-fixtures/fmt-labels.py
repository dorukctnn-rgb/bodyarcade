# Rewrites labels.json one fixture per line (the file's hand-edited style). python -I tools/form-fixtures/fmt-labels.py
import json, os
p = os.path.join(os.path.dirname(__file__), 'labels.json')
d = json.load(open(p, encoding='utf-8'))
def ser(v):
    if isinstance(v, dict):
        return '{ ' + ', '.join(f'{json.dumps(k)}: {ser(x)}' for k, x in v.items()) + ' }' if v else '{}'
    if isinstance(v, list):
        return '[' + ', '.join(ser(x) for x in v) + ']'
    return json.dumps(v, ensure_ascii=False)
lines = [f'  {json.dumps(k)}: {ser(v)}' for k, v in d.items()]
open(p, 'w', encoding='utf-8', newline='\n').write('{\n' + ',\n'.join(lines) + '\n}\n')
