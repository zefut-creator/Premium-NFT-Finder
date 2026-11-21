import ast
import json
import pathlib
import unittest

SOURCE = pathlib.Path("plugins/sayplugin/sayplugin.plugin")


def load_pure_functions():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    wanted = {"parse_shortcuts", "safe_json_list", "clean_text"}
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in wanted]
    namespace = {"Any": object, "Dict": dict, "List": list, "json": json, "re": __import__("re")}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace


class CoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.core = load_pure_functions()

    def test_shortcut_parser_ignores_invalid_lines(self):
        parsed = self.core["parse_shortcuts"](";пр=Привет\nwrong\n;bad key=no\n;спс=Спасибо")
        self.assertEqual(parsed, {";пр": "Привет", ";спс": "Спасибо"})

    def test_shortcut_value_is_limited(self):
        parsed = self.core["parse_shortcuts"](";x=" + ("a" * 2500))
        self.assertEqual(len(parsed[";x"]), 2000)

    def test_json_archive_recovers_from_corruption(self):
        self.assertEqual(self.core["safe_json_list"]("broken"), [])
        self.assertEqual(self.core["safe_json_list"]('[{"text":"ok"}, 3]'), [{"text": "ok"}])

    def test_clean_text(self):
        self.assertEqual(self.core["clean_text"]("  hello   world  \n\n\n next  "), "hello world\n\nnext")


if __name__ == "__main__":
    unittest.main()
