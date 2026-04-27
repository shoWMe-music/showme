INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-images', 'profile-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Allow public read access on profile-images"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile-images');

CREATE POLICY "Allow public insert access on profile-images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'profile-images');

CREATE POLICY "Allow public delete access on profile-images"
ON storage.objects FOR DELETE
USING (bucket_id = 'profile-images');