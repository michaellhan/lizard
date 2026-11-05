// @vitest-environment node
// The page's port of breakdown.py's categories against the engine's own: these cases, one for each (made, draw, board
// size) a 40,000-hand comparison reached, are breakdown.made_category's and draw_category's answers, copied out of a run
// of that file. (That comparison, on all 40,000, had no difference.)
import { describe, expect, it } from "vitest";
import { cardInt } from "@/library/entry";
import { DRAWS, drawCategory, MADE, madeCategory } from "./categories";

const CASES: readonly (readonly [string, string, string, string])[] = [
  ["8hAs", "4h3cJs", "ace_high", "backdoor"],
  ["JhAh", "QcKh2h", "ace_high", "combo"],
  ["7hAh", "4h5h8cTd", "ace_high", "combo"],
  ["5cAs", "8cKc2c", "ace_high", "fd"],
  ["5cAc", "8c8d9cKd", "ace_high", "fd"],
  ["5sAs", "2c3cQd", "ace_high", "gutshot"],
  ["4hAc", "6hQs5s2h", "ace_high", "gutshot"],
  ["5dAd", "Kh8hKs", "ace_high", "none"],
  ["KcAc", "Qs9h4d9d", "ace_high", "none"],
  ["8hAc", "7cTh9h", "ace_high", "oesd"],
  ["7sAh", "8h6h3c5d", "ace_high", "oesd"],
  ["9cAc", "5c8c2c", "flush", "backdoor"],
  ["8s9s", "3s6sTs", "flush", "gutshot"],
  ["QsKs", "9dTs2s4s", "flush", "gutshot"],
  ["JcQc", "6c3c2c", "flush", "none"],
  ["2hJh", "4hKh3hQs", "flush", "none"],
  ["5h6h", "Ah7h8h", "flush", "oesd"],
  ["6c8c", "5cTd7cTc", "flush", "oesd"],
  ["9cQc", "9sQdQs", "full_house", "none"],
  ["4sTc", "4cTh4h7h", "full_house", "none"],
  ["9dJs", "4hTd9s", "middle", "backdoor"],
  ["9dQd", "Td9h8d", "middle", "combo"],
  ["5c6d", "2h7d5d4d", "middle", "combo"],
  ["6cTd", "TcAc3c", "middle", "fd"],
  ["3s9d", "4s2c9sKs", "middle", "fd"],
  ["2c4s", "Ac3s4c", "middle", "gutshot"],
  ["6c7d", "6d9h4d3s", "middle", "gutshot"],
  ["5cKd", "2dJc5h", "middle", "none"],
  ["7hKs", "KcAsQdTd", "middle", "none"],
  ["JdKc", "QcJsTh", "middle", "oesd"],
  ["ThQh", "TcJd9c5h", "middle", "oesd"],
  ["7hKs", "8d2dTs", "nothing", "backdoor"],
  ["3s4s", "6s5s8d", "nothing", "combo"],
  ["6c7d", "Jc9d5c9c", "nothing", "combo"],
  ["7cQc", "Jc8c8s", "nothing", "fd"],
  ["2dJd", "QsTd5d6h", "nothing", "fd"],
  ["2sQh", "Js9s8d", "nothing", "gutshot"],
  ["9hKc", "7cQhJh6s", "nothing", "gutshot"],
  ["JcQh", "2h3d3s", "nothing", "none"],
  ["7dKh", "Th6dTcTd", "nothing", "none"],
  ["8hTc", "Js6s9s", "nothing", "oesd"],
  ["2h6h", "8s3d5d7d", "nothing", "oesd"],
  ["AcAs", "3c4cJs", "overpair", "backdoor"],
  ["7c7d", "5c4c3c", "overpair", "combo"],
  ["KcKh", "2hQh9hTc", "overpair", "combo"],
  ["JdJs", "Ts9s2s", "overpair", "fd"],
  ["QcQh", "5hTh3h3c", "overpair", "fd"],
  ["KcKh", "JdQd9d", "overpair", "gutshot"],
  ["AcAd", "JhQdKc3d", "overpair", "gutshot"],
  ["JcJd", "8c3d3s", "overpair", "none"],
  ["AhAs", "9dKd9s8c", "overpair", "none"],
  ["TcTh", "9h8d7c", "overpair", "oesd"],
  ["6d6h", "5h5c3h4s", "overpair", "oesd"],
  ["7sTs", "7c7d7h", "quads", "none"],
  ["2cTd", "2s2h4c2d", "quads", "none"],
  ["8c8h", "Kc8s3c", "set", "backdoor"],
  ["5d5h", "Ah5c7h8h", "set", "fd"],
  ["4c4d", "4s8s5d", "set", "none"],
  ["6h6s", "6dTc7sQd", "set", "none"],
  ["3c4d", "5c2c6s", "straight", "backdoor"],
  ["TsQs", "9sJs8h", "straight", "fd"],
  ["8c9c", "Jc2hTc7d", "straight", "fd"],
  ["ThJs", "QdKhAc", "straight", "none"],
  ["3h7h", "4sQs6c5s", "straight", "none"],
  ["JhAh", "As6h3d", "top_gk", "backdoor"],
  ["9cKc", "TcKsJc", "top_gk", "combo"],
  ["TsAh", "8hJhAc9h", "top_gk", "combo"],
  ["JdQc", "8d7dQd", "top_gk", "fd"],
  ["ThQh", "Td6h8h4d", "top_gk", "fd"],
  ["TsQd", "Js8sQc", "top_gk", "gutshot"],
  ["QhKh", "9dTcKc6s", "top_gk", "gutshot"],
  ["8cKh", "8d3d5c", "top_gk", "none"],
  ["JcKh", "8d7d5hKd", "top_gk", "none"],
  ["QdKs", "TsKdJd", "top_gk", "oesd"],
  ["9dQh", "TdJh6dQs", "top_gk", "oesd"],
  ["9dAd", "9h2c8d", "top_tk", "backdoor"],
  ["KcAc", "KdJcTc", "top_tk", "combo"],
  ["5cAd", "3h3d5d2d", "top_tk", "combo"],
  ["8sAc", "6c8c4c", "top_tk", "fd"],
  ["KcAc", "7dTcAs7c", "top_tk", "fd"],
  ["QdAh", "TdQcJs", "top_tk", "gutshot"],
  ["KhAd", "JdTdAs2s", "top_tk", "gutshot"],
  ["KhAs", "2d9sAh", "top_tk", "none"],
  ["KdAs", "Ah5hJcJs", "top_tk", "none"],
  ["4dKd", "Kc9d6h", "top_wk", "backdoor"],
  ["8dTc", "7dTd6d", "top_wk", "combo"],
  ["2dAs", "Ad4sKd3d", "top_wk", "combo"],
  ["6hJc", "4c6c3c", "top_wk", "fd"],
  ["6sKs", "9sKc8s8d", "top_wk", "fd"],
  ["7sJd", "TcJs8c", "top_wk", "gutshot"],
  ["8h9d", "5c6s9h4d", "top_wk", "gutshot"],
  ["4hKh", "Kd9c8c", "top_wk", "none"],
  ["9dAc", "Jd5s2dAs", "top_wk", "none"],
  ["9cTh", "7h9s8s", "top_wk", "oesd"],
  ["4d6s", "6h3c5s3s", "top_wk", "oesd"],
  ["TsJd", "Jc5sJs", "trips", "backdoor"],
  ["4d5s", "5d7d8d5c", "trips", "combo"],
  ["3s4s", "TsKs3h3c", "trips", "fd"],
  ["7d8s", "4h7c7s5c", "trips", "gutshot"],
  ["7sAs", "7d7c4d", "trips", "none"],
  ["3d7s", "7c7dAc6s", "trips", "none"],
  ["7c9s", "7h6h8d7d", "trips", "oesd"],
  ["5sTh", "5dTs4s", "two_pair", "backdoor"],
  ["2h6d", "2d7d6c4d", "two_pair", "fd"],
  ["2hKs", "2s8dKd", "two_pair", "none"],
  ["7dKh", "TdTc7cKd", "two_pair", "none"],
  ["4d4s", "Jd9sJs", "weak", "backdoor"],
  ["2h4h", "Ah4d5h", "weak", "combo"],
  ["8h8s", "Qh9hTc5h", "weak", "combo"],
  ["3h4h", "4sAhTh", "weak", "fd"],
  ["7d7s", "Td4dAd4h", "weak", "fd"],
  ["5c5h", "6h4h8s", "weak", "gutshot"],
  ["4h8h", "4d6c3c7d", "weak", "gutshot"],
  ["3sTh", "4d3h5s", "weak", "none"],
  ["4cTh", "7cQs4d2c", "weak", "none"],
  ["8c8s", "TdJh9h", "weak", "oesd"],
  ["2s4h", "5h3d2d3s", "weak", "oesd"],
];

const cards = (s: string) => s.match(/../g)!.map(cardInt);

describe("hand categories", () => {
  it.each(CASES)("%s on %s: %s, %s", (hole, board, made, draw) => {
    const [a, b] = cards(hole) as [number, number];
    expect(madeCategory([a, b], cards(board))).toBe(made);
    expect(drawCategory([a, b], cards(board))).toBe(draw);
  });

  it("every id is in the engine's lists", () => {
    const made = new Set(MADE.map(([id]) => id));
    const draws = new Set(DRAWS.map(([id]) => id));
    for (const c of CASES) {
      expect(made.has(c[2])).toBe(true);
      expect(draws.has(c[3])).toBe(true);
    }
  });
});
