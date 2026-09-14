"""Keep named fragments from becoming whole-character exemplars."""
import re


def character_part(name: str) -> bool:
    normalized = re.sub(r'[_/\s]+', '-', name.lower())
    normalized = re.sub(r'-\d+$', '', normalized)
    if re.search(r'(?:^|-)(?:full|whole)-body$', normalized):
        return False
    return bool(re.search(r'(?:^|-)(?:body-only|body|wing|wings|beak|eye|eyes|eyes-only|face-only|head-only|foot|feet|hand|hands|tail|arm|arms|leg|legs)(?:-only)?$', normalized))
