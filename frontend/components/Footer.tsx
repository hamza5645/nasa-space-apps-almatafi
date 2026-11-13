export default function Footer() {
  return (
    <footer className="site wrap">
      <span>Almatafi · NASA Space Apps Cairo 2026 · Harmonization of MODIS and VIIRS Hot Spots</span>
      <span>
        Fire data: <a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a> (MODIS C6.1, VIIRS 375 m)
      </span>
      {/* FIRMS's requested acknowledgement (earthdata.nasa.gov/data/tools/firms). */}
      <span className="ack">
        We acknowledge the use of data and imagery from NASA&apos;s Fire Information for Resource Management System
        (<a href="https://www.earthdata.nasa.gov/data/tools/firms">FIRMS</a>), part of NASA&apos;s Earth Science Data and
        Information System (<a href="https://www.earthdata.nasa.gov/about/esdis">ESDIS</a>), with near real-time data
        from <a href="https://www.earthdata.nasa.gov/data/instruments/viirs/land-near-real-time-data">LANCE</a> and
        imagery from <a href="https://earthdata.nasa.gov/gibs">GIBS</a>.
      </span>
    </footer>
  );
}
