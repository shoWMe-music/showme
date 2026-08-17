import { Link } from "@tanstack/react-router";

// Shared site footer for the Home + About routes. Product-column entries point
// at on-home-page section anchors; the Product/Contact standalone pages were
// removed, so no links to product.html / contact.html remain.
export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div className="footer__brand">
            <Link to="/" className="brand">
              <span className="brand__mark" aria-hidden="true">
                <svg viewBox="0 0 100 100" fill="none">
                  <path d="M8 48 A42 42 0 0 1 92 48 L92 92 L8 92 Z" fill="#EE5746" />
                  <path d="M50 14 L82 76 L18 76 Z" fill="#FFE1A0" />
                  <circle cx="50" cy="76" r="6" fill="#EE5746" />
                  <circle cx="34" cy="76" r="5" fill="#EE5746" />
                  <circle cx="66" cy="76" r="5" fill="#EE5746" />
                  <circle cx="22" cy="76" r="4" fill="#EE5746" />
                  <circle cx="78" cy="76" r="4" fill="#EE5746" />
                </svg>
              </span>
              <span>shoWMe</span>
            </Link>
            <p className="footer__tag">
              Built for events. Benefits everyone. Early access for venues, promoters &amp; booking
              agents across Scandinavia and Germany — early access for performers worldwide.
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li>
                <a href="/#product">Product</a>
              </li>
              <li>
                <a href="/#features">Features</a>
              </li>
              <li>
                <a href="/#ecosystem">Ecosystem</a>
              </li>
              <li>
                <a href="/#pricing">Pricing</a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Company</h4>
            <ul>
              <li>
                <Link to="/about">About</Link>
              </li>
              <li>
                <a href="#">Terms &amp; Conditions</a>
              </li>
              <li>
                <a href="#">Privacy Policy</a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Contact</h4>
            <ul>
              <li>
                <a href="https://showme.music">showme.music</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="footer__bottom">
          <span>© 2026 shoWMe. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}
