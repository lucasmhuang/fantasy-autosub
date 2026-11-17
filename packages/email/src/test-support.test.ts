import { describe, expect, it } from "vitest";
import { scanEmailHtml, visibleTextOf } from "./test-support";

const DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

describe("scanEmailHtml", () => {
  it("passes an email whose only address is the doctype's", () => {
    expect(
      scanEmailHtml(`${DOCTYPE}<html><body><p>Your code is 482913.</p></body></html>`)
    ).toEqual([]);
  });

  it.each([
    ["a link", '<p><a href="#">Open</a></p>', ["link: <a", "attribute: href"]],
    ["an image", '<img src="logo.png"/>', ["image: <img", "attribute: src"]],
    ["a button", "<button>Approve</button>", ["button: <button"]],
    ["a URL in the text", "<p>Go to https://example.com now</p>", ["url: https://"]],
    ["a domain in the text", "<p>Open example.com to approve</p>", ["domain: example.com"]],
    ["an address in the text", "<p>Write to sam@example.com</p>", ["address: sam@example.com"]],
  ])("names %s", (_name, body, problems) => {
    expect(scanEmailHtml(`${DOCTYPE}<html><body>${body}</body></html>`)).toEqual(
      expect.arrayContaining(problems)
    );
  });
});

describe("visibleTextOf", () => {
  it("reads the body's text by block, leaving out the head, comments and anything marked to skip", () => {
    const html = `${DOCTYPE}<html><head><style>a{color:red}</style></head><body><!--$--><p>Your code is <span>482913</span>.</p><table aria-hidden="true" data-skip-in-text="true"><tbody><tr><td>482<span>913</span></td></tr></tbody></table><p>It isn&#x27;t a link &amp; never was.<br/>Second line</p></body></html>`;
    expect(visibleTextOf(html)).toEqual([
      "Your code is 482913.",
      "It isn't a link & never was.",
      "Second line",
    ]);
  });
});
