import * as THREE from 'three';

/**
 * The rail.
 *
 * A centripetal Catmull-Rom through the surveyed waypoints. Centripetal (alpha
 * 0.5) rather than uniform because uniform Catmull-Rom cusps and self-
 * intersects on tight turns, and this route has two genuinely tight ones: the
 * hairpin off rue Lepic into rue d'Orchampt, and the dogleg where d'Orchampt
 * spills into Ravignan. A cusp there would whip the camera and read as a bug.
 */
export class Rail {
  /** @param {{x:number,y:number,z:number,id:string,width:number}[]} points */
  constructor(points) {
    this.points = points;
    this.vecs = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    this.curve = new THREE.CatmullRomCurve3(this.vecs, false, 'centripetal', 0.5);
    // Arc-length table so t is metres, not parameter units. Without this the
    // camera accelerates through straights and crawls through corners.
    //
    // Setting arcLengthDivisions BEFORE asking for the lengths matters: three
    // caches the table keyed on the division count, and a later internal
    // getLengths() with the default 200 would miss a cache built at 2000 and
    // silently recompute the whole table on every single sample. The world
    // builder takes thousands of samples, so that miss is the difference
    // between a fast load and a ten-second one.
    this.curve.arcLengthDivisions = 2000;
    this.arcLengths = this.curve.getLengths(2000);
    this.length = this.arcLengths[this.arcLengths.length - 1];
  }

  /**
   * Curve parameter u in [0,1] for a distance in metres along the rail.
   *
   * three's getUtoTmapping returns NaN for a distance exactly equal to the
   * curve's total length: its binary search lands on the final sample and then
   * divides by a zero-width segment. That is not a hypothetical — sampling a
   * loop as `(i / n) * rail.length` hits it on the last iteration every time.
   * Clamp the result and fall back to the linear fraction.
   */
  uAtDistance(metres) {
    const d = THREE.MathUtils.clamp(metres, 0, this.length);
    const u = this.curve.getUtoTmapping(0, d);
    if (!Number.isFinite(u)) return this.length > 0 ? d / this.length : 0;
    return THREE.MathUtils.clamp(u, 0, 1);
  }

  /** World position at a distance in metres. */
  positionAt(metres, out = new THREE.Vector3()) {
    return this.curve.getPoint(this.uAtDistance(metres), out);
  }

  /** Unit tangent (direction of travel) at a distance in metres. */
  tangentAt(metres, out = new THREE.Vector3()) {
    return this.curve.getTangent(this.uAtDistance(metres), out).normalize();
  }

  /**
   * Distance in metres to the waypoint with the given id. Encounters are
   * authored against waypoint ids, never raw numbers, so that moving a
   * coordinate in the survey moves the fight with it.
   */
  distanceToWaypoint(id) {
    const idx = this.points.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`Rail has no waypoint "${id}"`);
    let d = 0;
    for (let i = 1; i <= idx; i++) d += this.vecs[i].distanceTo(this.vecs[i - 1]);
    // Chord length underestimates arc length; rescale by the global ratio so
    // waypoints land where they look like they land.
    let chordTotal = 0;
    for (let i = 1; i < this.vecs.length; i++) chordTotal += this.vecs[i].distanceTo(this.vecs[i - 1]);
    return (d / chordTotal) * this.length;
  }

  /** Street half-width in metres, interpolated between waypoints. */
  widthAt(metres) {
    const u = this.uAtDistance(metres);
    const f = u * (this.points.length - 1);
    const i = Math.min(Math.floor(f), this.points.length - 2);
    const t = f - i;
    return THREE.MathUtils.lerp(this.points[i].width, this.points[i + 1].width, t);
  }
}
