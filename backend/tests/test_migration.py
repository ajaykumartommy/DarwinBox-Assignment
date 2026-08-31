import unittest

from app.migration import parse_csv, process_rows, safe_iso_date


SCHEMA = {
    "entity": "employee",
    "fields": [
        {"name": "employeeNumber", "required": True},
        {"name": "given_name", "required": True},
        {"name": "email", "required": True, "format": "email"},
        {"name": "joined_on", "required": True, "format": "date"},
    ],
}


class MigrationTests(unittest.TestCase):
    def test_unambiguous_date_is_normalized(self):
        self.assertEqual(safe_iso_date("14/03/2022"), "2022-03-14")

    def test_ambiguous_date_is_not_guessed(self):
        self.assertIsNone(safe_iso_date("03/04/2022"))

    def test_required_value_and_ambiguous_date_escalate(self):
        rows = parse_csv(b"employee_id,first_name,work_email,start_date\nEMP-1,Ada,,03/04/2022\n")
        result = process_rows(rows, SCHEMA)
        kinds = {item.kind for item in result.escalations}
        self.assertIn("ambiguous_date", kinds)
        self.assertIn("validation_failure", kinds)

    def test_invalid_value_escalates_after_two_validation_passes(self):
        rows = parse_csv(b"employee_id,first_name,work_email,start_date\nEMP-1,Ada,not-an-email,2022-03-14\n")
        result = process_rows(rows, SCHEMA)
        failure = next(item for item in result.escalations if item.kind == "validation_failure")
        self.assertEqual(failure.evidence["validation_attempts"], 2)

    def test_safe_duplicates_are_consolidated(self):
        rows = parse_csv(b"employee_id,first_name,work_email,start_date\nEMP-1,Ada,ada@example.com,14/03/2022\nEMP-1,Ada,ada@example.com,14/03/2022\n")
        result = process_rows(rows, SCHEMA)
        self.assertEqual(len(result.records), 1)
        self.assertEqual(result.duplicates_consolidated, 1)


if __name__ == "__main__":
    unittest.main()
