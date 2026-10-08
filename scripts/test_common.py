import tempfile
import unittest
from pathlib import Path

from common import extensionInfo, preserveExistingOrder


class ExtensionInfoTests(unittest.TestCase):
    def test_reads_every_source_from_a_shared_extension_file(self):
        source = '''const mangayomiSources = [
          {"name": "First", "lang": "en"},
          {"name": "Second", "lang": "en"},
        ];
        class DefaultExtension {}
        '''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "shared.js"
            path.write_text(source, encoding="utf-8")

            entries = extensionInfo(path)

        self.assertEqual([entry["name"] for entry in entries], ["First", "Second"])

    def test_generator_keeps_existing_entries_in_their_published_order(self):
        existing = [
            {"name": "Second", "lang": "en"},
            {"name": "First", "lang": "en"},
        ]
        generated = [
            {"name": "First", "lang": "en"},
            {"name": "Added Z", "lang": "en"},
            {"name": "Second", "lang": "en"},
            {"name": "Added A", "lang": "en"},
        ]

        ordered = preserveExistingOrder(generated, existing)

        self.assertEqual(
            [entry["name"] for entry in ordered],
            ["Second", "First", "Added A", "Added Z"],
        )


if __name__ == "__main__":
    unittest.main()
