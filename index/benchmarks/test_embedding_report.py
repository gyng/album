import unittest

from embedding_report import dcg, ndcg, paired_interval


class RankingMetricsTest(unittest.TestCase):
    def test_perfect_and_reversed_rankings(self):
        self.assertEqual(ndcg([3, 2, 1, 0, 0], [3, 2, 1, 0, 0]), 1)
        self.assertLess(ndcg([0, 0, 1, 2, 3], [3, 2, 1, 0, 0]), 1)
        self.assertEqual(dcg([3, 0]), 7)

    def test_uninformative_pool_is_excluded(self):
        self.assertIsNone(ndcg([0, 0], [0, 0]))

    def test_pool_ideal_is_sorted_and_capped_at_three(self):
        self.assertEqual(ndcg([3, 3, 3], [0, 3, 3, 3, 3, 3, 1]), 1)

    def test_constant_paired_improvement_has_constant_interval(self):
        interval = paired_interval([0.1, 0.1, 0.1])
        self.assertAlmostEqual(interval["low95"], 0.1)
        self.assertAlmostEqual(interval["high95"], 0.1)
        self.assertEqual(interval["wins"], 3)
        self.assertEqual(interval["ties"], 0)


if __name__ == "__main__":
    unittest.main()
